import { createHash } from "crypto";
import { getSupabase } from "@/lib/supabase/server";
import { getInvoices, syncFinanceVendorDateFromInvoicesForProject } from "@/lib/db/finance";
import { getMasterList } from "@/lib/db/master";
import { findReconciliationCandidates } from "@/lib/reconciliation/matching";
import type {
  BankImportRow,
  BankTransactionStatus,
  MatchingBankTransaction,
  MatchingInvoice,
  MatchingSubmission,
  ReconciliationEvidence,
  ReconciliationDashboardRun,
  ReconciliationDashboardTransaction,
} from "@/lib/reconciliation/types";

function textOrNull(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function ymdOrNull(value: unknown): string | null {
  const text = String(value ?? "").trim().replace(/\//g, "-");
  const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) return null;
  const ymd = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  const date = new Date(`${ymd}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  if (
    date.getUTCFullYear() !== Number(match[1]) ||
    date.getUTCMonth() + 1 !== Number(match[2]) ||
    date.getUTCDate() !== Number(match[3])
  ) {
    return null;
  }
  return ymd;
}

function moneyOrNull(value: unknown): number | null {
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .replace(/[,\s$NTD]/gi, "")
    .replace(/[()]/g, "");
  if (!normalized) return null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return null;
  return Math.round(Math.abs(amount) * 100) / 100;
}

function last5(value: unknown): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 5 ? digits.slice(-5) : null;
}

function reconciliationEvidence(value: unknown): ReconciliationEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const row = item as Record<string, unknown>;
      const status = String(row.status ?? "missing");
      return {
        key: String(row.key ?? `evidence-${index}`),
        label: String(row.label ?? "判斷條件"),
        status: ["matched", "close", "missing", "mismatch"].includes(status)
          ? (status as ReconciliationEvidence["status"])
          : "missing",
        detail: String(row.detail ?? ""),
        score: Number(row.score ?? 0),
      };
    }
    const reason = String(item ?? "").trim();
    return {
      key: `legacy-${index}`,
      label: "既有匹配依據",
      status: reason.includes("相差") || reason.includes("相近") || reason.includes("容許差額") ? "close" : "matched",
      detail: reason,
      score: 0,
    };
  });
}

function transactionFingerprint(row: {
  transactionDate: string;
  amount: number;
  bankReference: string | null;
  counterpartyLast5: string | null;
  counterpartyName: string | null;
  description: string | null;
}): string {
  const stable = row.bankReference
    ? `ref|${row.bankReference}|${row.transactionDate}|${row.amount.toFixed(2)}`
    : [
        "fallback",
        row.transactionDate,
        row.amount.toFixed(2),
        row.counterpartyLast5 ?? "",
        row.counterpartyName ?? "",
        row.description ?? "",
      ].join("|");
  return createHash("sha256").update(stable.normalize("NFKC")).digest("hex");
}

export async function importBankTransactions(
  rows: BankImportRow[],
  meta: { filename?: string; importedBy: string; source?: string }
): Promise<{ runId: string; imported: number; duplicates: number; errors: string[] }> {
  const supabase = getSupabase();
  const source = textOrNull(meta.source) ?? "cathay_csv";
  const errors: string[] = [];
  const payload: Record<string, unknown>[] = [];

  rows.forEach((row, index) => {
    const transactionDate = ymdOrNull(row.transactionDate);
    const amount = moneyOrNull(row.amount);
    const direction = row.direction === "debit" ? "debit" : "credit";
    if (!transactionDate) {
      errors.push(`第 ${index + 2} 列：交易日期格式不正確`);
      return;
    }
    if (amount == null || amount <= 0) {
      errors.push(`第 ${index + 2} 列：金額格式不正確`);
      return;
    }
    if (direction !== "credit") return;

    const bankReference = textOrNull(row.bankReference);
    const counterpartyName = textOrNull(row.counterpartyName);
    const counterpartyAccount = textOrNull(row.counterpartyAccount);
    const counterpartyLast5 = last5(row.counterpartyLast5 ?? counterpartyAccount);
    const description = textOrNull(row.description);
    const fingerprint = transactionFingerprint({
      transactionDate,
      amount,
      bankReference,
      counterpartyLast5,
      counterpartyName,
      description,
    });
    payload.push({
      來源: source,
      來源帳戶: textOrNull(row.sourceAccount),
      銀行交易序號: bankReference,
      交易日期: transactionDate,
      入帳日期: ymdOrNull(row.bookingDate),
      金額: amount,
      幣別: textOrNull(row.currency) ?? "TWD",
      方向: direction,
      匯款人: counterpartyName,
      匯款帳號: counterpartyAccount,
      匯款末五碼: counterpartyLast5,
      交易摘要: description,
      原始資料: row.raw ?? {},
      指紋: fingerprint,
      狀態: "unmatched",
      匯入人: meta.importedBy,
    });
  });

  const { data: run, error: runError } = await supabase
    .from("對帳執行紀錄")
    .insert({
      來源: source,
      檔名: textOrNull(meta.filename),
      原始筆數: rows.length,
      匯入筆數: 0,
      重複筆數: 0,
      錯誤筆數: errors.length,
      錯誤明細: errors,
      執行人: meta.importedBy,
    })
    .select("id")
    .single();
  if (runError) throw runError;

  const withRun = payload.map((row) => ({ ...row, 匯入批次ID: run.id }));
  let imported = 0;
  if (withRun.length > 0) {
    const { data, error } = await supabase
      .from("銀行交易")
      .upsert(withRun, { onConflict: "指紋", ignoreDuplicates: true })
      .select("id");
    if (error) throw error;
    imported = data?.length ?? 0;
  }
  const duplicates = Math.max(0, withRun.length - imported);

  const { error: updateRunError } = await supabase
    .from("對帳執行紀錄")
    .update({ 匯入筆數: imported, 重複筆數: duplicates })
    .eq("id", run.id);
  if (updateRunError) throw updateRunError;

  return { runId: String(run.id), imported, duplicates, errors };
}

function mapMatchingInvoices(rows: Awaited<ReturnType<typeof getInvoices>>): MatchingInvoice[] {
  return rows
    .map((row) => ({
      id: String(row.id ?? "").trim(),
      projectId: String(row.專案ID ?? "").trim(),
      invoiceNumber: String(row.發票號碼 ?? "").trim(),
      amount: moneyOrNull(row.發票金額含稅) ?? 0,
      recipient: String(row.收款對象 ?? "").trim(),
      paidDate: String(row.廠商付款日期 ?? "").trim(),
    }))
    .filter((row) => row.id && row.projectId);
}

export async function runReconciliationMatching(): Promise<{
  scanned: number;
  transactionsWithCandidates: number;
  candidates: number;
}> {
  const supabase = getSupabase();
  const [{ data: transactionRows, error: txError }, invoices, submissionResult] = await Promise.all([
    supabase
      .from("銀行交易")
      .select("*")
      .in("狀態", ["unmatched", "suggested"])
      .eq("方向", "credit")
      .order("交易日期", { ascending: false })
      .limit(500),
    getInvoices(),
    supabase.from("收款申報").select("*").order("submitted_at", { ascending: false }),
  ]);
  if (txError) throw txError;
  if (submissionResult.error && !["42P01", "PGRST205"].includes(submissionResult.error.code ?? "")) {
    throw submissionResult.error;
  }

  const matchingInvoices = mapMatchingInvoices(invoices);
  const submissions: MatchingSubmission[] = (submissionResult.data ?? []).map((row) => ({
    id: String(row.id ?? ""),
    projectId: String(row.專案ID ?? "").trim(),
    remitDate: String(row.匯款日期 ?? "").slice(0, 10),
    amount: moneyOrNull(row.匯款金額),
    last5: String(row.匯款末五碼 ?? "").replace(/\D/g, "").slice(-5),
    remitter: String(row.匯款單位 ?? "").trim(),
  }));
  const transactions: MatchingBankTransaction[] = (transactionRows ?? []).map((row) => ({
    id: String(row.id),
    transactionDate: String(row.交易日期 ?? "").slice(0, 10),
    amount: moneyOrNull(row.金額) ?? 0,
    direction: row.方向 === "debit" ? "debit" : "credit",
    counterpartyName: String(row.匯款人 ?? "").trim(),
    counterpartyLast5: String(row.匯款末五碼 ?? "").trim(),
    description: String(row.交易摘要 ?? "").trim(),
  }));

  const transactionIds = transactions.map((row) => row.id);
  if (transactionIds.length > 0) {
    const { error } = await supabase
      .from("對帳結果")
      .delete()
      .in("銀行交易ID", transactionIds)
      .eq("狀態", "suggested");
    if (error) throw error;
  }

  const existingCandidateKeys = new Set<string>();
  if (transactionIds.length > 0) {
    const { data, error } = await supabase
      .from("對帳結果")
      .select('"銀行交易ID","候選識別碼"')
      .in("銀行交易ID", transactionIds);
    if (error) throw error;
    for (const row of data ?? []) {
      existingCandidateKeys.add(`${String(row.銀行交易ID)}|${String(row.候選識別碼)}`);
    }
  }

  let transactionsWithCandidates = 0;
  let candidateCount = 0;
  for (const transaction of transactions) {
    const candidates = findReconciliationCandidates(transaction, matchingInvoices, submissions).filter(
      (candidate) => !existingCandidateKeys.has(`${transaction.id}|${candidate.candidateKey}`)
    );
    if (candidates.length === 0) {
      await supabase.from("銀行交易").update({ 狀態: "unmatched", updated_at: new Date().toISOString() }).eq("id", transaction.id);
      continue;
    }
    const { error } = await supabase.from("對帳結果").insert(
      candidates.map((candidate) => ({
        銀行交易ID: candidate.transactionId,
        收款申報ID: candidate.submissionId,
        專案ID: candidate.projectId,
        發票IDs: candidate.invoiceIds,
        候選識別碼: candidate.candidateKey,
        候選金額: candidate.candidateAmount,
        分數: candidate.score,
        匹配原因: candidate.evidence,
        狀態: "suggested",
      }))
    );
    if (error) throw error;
    await supabase.from("銀行交易").update({ 狀態: "suggested", updated_at: new Date().toISOString() }).eq("id", transaction.id);
    transactionsWithCandidates += 1;
    candidateCount += candidates.length;
  }

  return { scanned: transactions.length, transactionsWithCandidates, candidates: candidateCount };
}

function externalErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = String((error as { message?: unknown }).message ?? "").trim();
    if (message) return message;
  }
  return fallback;
}

export async function confirmReconciliationMatch(
  matchId: string,
  confirmedBy: string
): Promise<{ projectId: string; syncWarning: string | null }> {
  const { data, error } = await getSupabase().rpc("confirm_reconciliation_match", {
    p_match_id: matchId,
    p_confirmed_by: confirmedBy,
  });
  if (error) throw new Error(externalErrorMessage(error, "確認對帳資料庫操作失敗"));
  const first = Array.isArray(data) ? data[0] : data;
  const projectId = String(first?.專案ID ?? "").trim();
  if (!projectId) return { projectId: "", syncWarning: null };
  try {
    await syncFinanceVendorDateFromInvoicesForProject(projectId);
    return { projectId, syncWarning: null };
  } catch (syncError) {
    return {
      projectId,
      syncWarning: externalErrorMessage(syncError, "財務與分潤同步失敗，請人工檢查"),
    };
  }
}

export async function rejectReconciliationMatch(matchId: string): Promise<void> {
  const supabase = getSupabase();
  const { data: match, error: readError } = await supabase
    .from("對帳結果")
    .select('id,"銀行交易ID","狀態"')
    .eq("id", matchId)
    .maybeSingle();
  if (readError) throw readError;
  if (!match) throw new Error("找不到對帳候選");
  if (match.狀態 === "confirmed") throw new Error("已確認的對帳不可直接排除");
  const { error } = await supabase
    .from("對帳結果")
    .update({ 狀態: "rejected", updated_at: new Date().toISOString() })
    .eq("id", matchId);
  if (error) throw error;
  const { count } = await supabase
    .from("對帳結果")
    .select("id", { count: "exact", head: true })
    .eq("銀行交易ID", match.銀行交易ID)
    .eq("狀態", "suggested");
  if ((count ?? 0) === 0) {
    await supabase.from("銀行交易").update({ 狀態: "unmatched", updated_at: new Date().toISOString() }).eq("id", match.銀行交易ID);
  }
}

export async function setBankTransactionIgnored(transactionId: string, ignored: boolean): Promise<void> {
  const supabase = getSupabase();
  const { data: row, error: readError } = await supabase
    .from("銀行交易")
    .select('id,"狀態"')
    .eq("id", transactionId)
    .maybeSingle();
  if (readError) throw readError;
  if (!row) throw new Error("找不到銀行交易");
  if (row.狀態 === "matched") throw new Error("已完成對帳的交易不可忽略");
  if (ignored) {
    const { error } = await supabase
      .from("對帳結果")
      .delete()
      .eq("銀行交易ID", transactionId)
      .eq("狀態", "suggested");
    if (error) throw error;
  }
  const { error } = await supabase
    .from("銀行交易")
    .update({ 狀態: ignored ? "ignored" : "unmatched", updated_at: new Date().toISOString() })
    .eq("id", transactionId);
  if (error) throw error;
}

export async function getReconciliationDashboard(): Promise<{
  transactions: ReconciliationDashboardTransaction[];
  runs: ReconciliationDashboardRun[];
}> {
  const supabase = getSupabase();
  const [{ data: transactions, error: txError }, { data: runs, error: runError }, invoices, masters] = await Promise.all([
    supabase.from("銀行交易").select("*").order("交易日期", { ascending: false }).order("created_at", { ascending: false }).limit(200),
    supabase.from("對帳執行紀錄").select("*").order("created_at", { ascending: false }).limit(20),
    getInvoices(),
    getMasterList(),
  ]);
  if (txError) throw txError;
  if (runError) throw runError;

  const ids = (transactions ?? []).map((row) => String(row.id));
  let matches: Record<string, unknown>[] = [];
  if (ids.length > 0) {
    const result = await supabase
      .from("對帳結果")
      .select("*")
      .in("銀行交易ID", ids)
      .order("分數", { ascending: false });
    if (result.error) throw result.error;
    matches = (result.data ?? []) as Record<string, unknown>[];
  }

  const invoiceById = new Map(
    invoices.map((row) => [
      String(row.id ?? ""),
      {
        id: String(row.id ?? ""),
        number: String(row.發票號碼 ?? "").trim(),
        issueDate: String(row.發票日期 ?? "").trim().slice(0, 10),
      },
    ])
  );
  const projectNameById = new Map(masters.map((row) => [String(row.專案ID ?? ""), String(row.專案名稱 ?? "")]));
  const matchesByTransaction = new Map<string, Record<string, unknown>[]>();
  for (const match of matches) {
    const id = String(match.銀行交易ID ?? "");
    const rows = matchesByTransaction.get(id) ?? [];
    rows.push(match);
    matchesByTransaction.set(id, rows);
  }

  const dashboardTransactions: ReconciliationDashboardTransaction[] = (transactions ?? []).map((row) => ({
    id: String(row.id),
    transactionDate: String(row.交易日期 ?? "").slice(0, 10),
    bookingDate: String(row.入帳日期 ?? "").slice(0, 10),
    amount: moneyOrNull(row.金額) ?? 0,
    currency: String(row.幣別 ?? "TWD"),
    counterpartyName: String(row.匯款人 ?? ""),
    counterpartyLast5: String(row.匯款末五碼 ?? ""),
    description: String(row.交易摘要 ?? ""),
    status: String(row.狀態 ?? "unmatched") as BankTransactionStatus,
    matches: (matchesByTransaction.get(String(row.id)) ?? []).map((match) => {
      const invoiceIds = Array.isArray(match.發票IDs) ? match.發票IDs.map(String) : [];
      const projectId = String(match.專案ID ?? "");
      const matchedInvoices = invoiceIds
        .map((id) => invoiceById.get(id))
        .filter((invoice): invoice is NonNullable<typeof invoice> => invoice != null);
      const evidence = reconciliationEvidence(match.匹配原因);
      return {
        id: String(match.id),
        projectId,
        projectName: projectNameById.get(projectId) ?? "",
        invoiceIds,
        invoiceNumbers: matchedInvoices.map((invoice) => invoice.number).filter(Boolean),
        invoices: matchedInvoices,
        candidateAmount: moneyOrNull(match.候選金額) ?? 0,
        score: Number(match.分數 ?? 0),
        reasons: evidence.map((item) => item.detail),
        evidence,
        status: String(match.狀態 ?? "suggested") as "suggested" | "confirmed" | "rejected",
        confirmedBy: String(match.確認人 ?? ""),
        confirmedAt: String(match.確認時間 ?? ""),
      };
    }),
  }));

  const dashboardRuns: ReconciliationDashboardRun[] = (runs ?? []).map((row) => ({
    id: String(row.id),
    source: String(row.來源 ?? ""),
    filename: String(row.檔名 ?? ""),
    rowCount: Number(row.原始筆數 ?? 0),
    importedCount: Number(row.匯入筆數 ?? 0),
    duplicateCount: Number(row.重複筆數 ?? 0),
    errorCount: Number(row.錯誤筆數 ?? 0),
    createdBy: String(row.執行人 ?? ""),
    createdAt: String(row.created_at ?? ""),
  }));
  return { transactions: dashboardTransactions, runs: dashboardRuns };
}
