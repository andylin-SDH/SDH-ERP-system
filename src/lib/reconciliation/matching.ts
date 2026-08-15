import type {
  MatchingBankTransaction,
  MatchingInvoice,
  MatchingSubmission,
  ReconciliationCandidate,
  ReconciliationEvidence,
} from "@/lib/reconciliation/types";

type InvoiceTarget = {
  projectId: string;
  invoiceIds: string[];
  invoiceNumbers: string[];
  amount: number;
  recipients: string[];
};

const MAX_BANK_SHORTFALL = 30;

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function amountText(value: number): string {
  return `$${value.toLocaleString("zh-TW", { maximumFractionDigits: 2 })}`;
}

function normalizeText(value: string): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function dateDistanceDays(a: string, b: string): number | null {
  const ta = Date.parse(`${a.slice(0, 10)}T00:00:00Z`);
  const tb = Date.parse(`${b.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return null;
  return Math.abs(Math.round((ta - tb) / 86_400_000));
}

function namesLookRelated(a: string, b: string): boolean {
  const x = normalizeText(a);
  const y = normalizeText(b);
  if (x.length < 2 || y.length < 2) return false;
  return x.includes(y) || y.includes(x);
}

function targetKey(projectId: string, invoiceIds: string[]): string {
  return `${projectId}:${[...invoiceIds].sort().join(",")}`;
}

/**
 * 同一專案只產生「全部未入帳發票合計」候選。
 * 現有 ERP 會把任一發票入帳日同步為整個專案已入帳，因此第一版不自動建議部分付款，
 * 避免多張發票只收到一部分款項時過早觸發財務與分潤流程。
 */
export function buildInvoiceTargets(invoices: MatchingInvoice[]): InvoiceTarget[] {
  const unpaid = invoices.filter(
    (invoice) => invoice.id && invoice.projectId && !invoice.paidDate && invoice.amount > 0
  );
  const byProject = new Map<string, MatchingInvoice[]>();
  for (const invoice of unpaid) {
    const rows = byProject.get(invoice.projectId) ?? [];
    rows.push(invoice);
    byProject.set(invoice.projectId, rows);
  }

  const targets = new Map<string, InvoiceTarget>();
  for (const [projectId, rows] of byProject) {
    const aggregate: InvoiceTarget = {
      projectId,
      invoiceIds: rows.map((row) => row.id).sort(),
      invoiceNumbers: rows.map((row) => row.invoiceNumber).filter(Boolean),
      amount: roundMoney(rows.reduce((sum, row) => sum + row.amount, 0)),
      recipients: [...new Set(rows.map((row) => row.recipient).filter(Boolean))],
    };
    targets.set(targetKey(projectId, aggregate.invoiceIds), aggregate);
  }
  return [...targets.values()];
}

function scoreSubmission(
  transaction: MatchingBankTransaction,
  submission: MatchingSubmission
): { score: number; reasons: string[]; evidence: ReconciliationEvidence[] } {
  let score = 0;
  const reasons: string[] = [];
  const evidence: ReconciliationEvidence[] = [];

  if (submission.amount == null) {
    evidence.push({
      key: "submission_amount",
      label: "銀行金額 vs ERP 申報金額",
      status: "missing",
      detail: `銀行 ${amountText(transaction.amount)}；ERP 未填申報金額`,
      score: 0,
    });
  } else {
    const difference = roundMoney(submission.amount - transaction.amount);
    const amountMatched = Math.abs(difference) < 0.01;
    if (amountMatched) {
      score += 5;
      reasons.push("收款申報金額一致");
    }
    evidence.push({
      key: "submission_amount",
      label: "銀行金額 vs ERP 申報金額",
      status: amountMatched ? "matched" : "mismatch",
      detail: `銀行 ${amountText(transaction.amount)}；ERP ${amountText(submission.amount)}；差額 ${amountText(Math.abs(difference))}`,
      score: amountMatched ? 5 : 0,
    });
  }

  if (!transaction.counterpartyLast5 || !submission.last5) {
    evidence.push({
      key: "last5",
      label: "帳號末五碼",
      status: "missing",
      detail: `銀行 ${transaction.counterpartyLast5 || "未提供"}；ERP ${submission.last5 || "未填寫"}；無法核對`,
      score: 0,
    });
  } else {
    const last5Matched = submission.last5 === transaction.counterpartyLast5;
    if (last5Matched) {
      score += 30;
      reasons.push("匯款帳號末五碼一致");
    }
    evidence.push({
      key: "last5",
      label: "帳號末五碼",
      status: last5Matched ? "matched" : "mismatch",
      detail: `銀行 ${transaction.counterpartyLast5}；ERP ${submission.last5}`,
      score: last5Matched ? 30 : 0,
    });
  }

  const days = dateDistanceDays(transaction.transactionDate, submission.remitDate);
  if (days === 0) {
    score += 15;
    reasons.push("匯款日期一致");
  } else if (days != null && days <= 2) {
    score += 10;
    reasons.push(`匯款日期相差 ${days} 天`);
  }
  evidence.push({
    key: "remit_date",
    label: "銀行日期 vs ERP 申報日期",
    status: days == null ? "missing" : days === 0 ? "matched" : days <= 2 ? "close" : "mismatch",
    detail:
      days == null
        ? `銀行 ${transaction.transactionDate || "未提供"}；ERP ${submission.remitDate || "未填寫"}；無法核對`
        : `銀行 ${transaction.transactionDate}；ERP ${submission.remitDate}；相差 ${days} 天`,
    score: days === 0 ? 15 : days != null && days <= 2 ? 10 : 0,
  });

  const bankRemitter = transaction.counterpartyName || transaction.description;
  const nameRelated = namesLookRelated(bankRemitter, submission.remitter);
  if (nameRelated) {
    score += 5;
    reasons.push("匯款人名稱相近");
  }
  evidence.push({
    key: "remitter",
    label: "銀行匯款人 vs ERP 申報單位",
    status: !bankRemitter || !submission.remitter ? "missing" : nameRelated ? "close" : "mismatch",
    detail: `銀行 ${bankRemitter || "未提供"}；ERP ${submission.remitter || "未填寫"}`,
    score: nameRelated ? 5 : 0,
  });
  return { score, reasons, evidence };
}

export function findReconciliationCandidates(
  transaction: MatchingBankTransaction,
  invoices: MatchingInvoice[],
  submissions: MatchingSubmission[]
): ReconciliationCandidate[] {
  if (transaction.direction !== "credit" || transaction.amount <= 0) return [];
  const submissionsByProject = new Map<string, MatchingSubmission[]>();
  for (const submission of submissions) {
    const rows = submissionsByProject.get(submission.projectId) ?? [];
    rows.push(submission);
    submissionsByProject.set(submission.projectId, rows);
  }

  const candidates: ReconciliationCandidate[] = [];
  for (const target of buildInvoiceTargets(invoices)) {
    const bankShortfall = roundMoney(target.amount - transaction.amount);
    if (bankShortfall < 0 || bankShortfall > MAX_BANK_SHORTFALL) continue;

    let score = 50;
    const reasons = [
      bankShortfall === 0
        ? "銀行入帳金額與未入帳發票一致"
        : `銀行入帳較未入帳發票少 ${bankShortfall.toLocaleString("zh-TW", {
            maximumFractionDigits: 2,
          })} 元（容許差額）`,
    ];
    const evidence: ReconciliationEvidence[] = [
      {
        key: "invoice_amount",
        label: "銀行金額 vs 未入帳發票合計",
        status: bankShortfall === 0 ? "matched" : "close",
        detail: `銀行 ${amountText(transaction.amount)}；發票 ${amountText(target.amount)}；差額 ${amountText(bankShortfall)}`,
        score: 50,
      },
    ];
    const projectSubmissions = submissionsByProject.get(target.projectId) ?? [];
    let bestSubmission: MatchingSubmission | null = projectSubmissions[0] ?? null;
    let bestExtra = bestSubmission
      ? scoreSubmission(transaction, bestSubmission)
      : { score: 0, reasons: [] as string[], evidence: [] as ReconciliationEvidence[] };
    for (const submission of projectSubmissions.slice(1)) {
      const extra = scoreSubmission(transaction, submission);
      if (extra.score > bestExtra.score) {
        bestSubmission = submission;
        bestExtra = extra;
      }
    }
    score += bestExtra.score;
    reasons.push(...bestExtra.reasons);
    evidence.push(...bestExtra.evidence);

    if (!bestSubmission) {
      evidence.push({
        key: "payment_submission",
        label: "ERP 收款申報",
        status: "missing",
        detail: "此專案沒有收款申報，無法核對申報金額、末五碼、日期與匯款單位",
        score: 0,
      });
      const relatedRecipient = target.recipients.find((name) => namesLookRelated(name, transaction.counterpartyName));
      if (relatedRecipient) {
        score += 5;
        reasons.push("匯款人與發票收款對象名稱相近");
      }
      evidence.push({
        key: "invoice_recipient",
        label: "銀行匯款人 vs 發票收款對象",
        status: !transaction.counterpartyName || target.recipients.length === 0 ? "missing" : relatedRecipient ? "close" : "mismatch",
        detail: `銀行 ${transaction.counterpartyName || "未提供"}；發票 ${target.recipients.join("、") || "未填寫"}`,
        score: relatedRecipient ? 5 : 0,
      });
    }

    const candidateKey = targetKey(target.projectId, target.invoiceIds);
    candidates.push({
      candidateKey,
      transactionId: transaction.id,
      projectId: target.projectId,
      invoiceIds: target.invoiceIds,
      invoiceNumbers: target.invoiceNumbers,
      candidateAmount: target.amount,
      score: Math.min(score, 100),
      reasons,
      evidence,
      submissionId: bestSubmission?.id ?? null,
    });
  }

  return candidates
    .sort((a, b) => b.score - a.score || a.candidateKey.localeCompare(b.candidateKey))
    .slice(0, 3);
}
