import type {
  MatchingBankTransaction,
  MatchingInvoice,
  MatchingSubmission,
  ReconciliationCandidate,
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
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  if (submission.amount != null && Math.abs(submission.amount - transaction.amount) < 0.01) {
    score += 5;
    reasons.push("收款申報金額一致");
  }
  if (
    submission.last5 &&
    transaction.counterpartyLast5 &&
    submission.last5 === transaction.counterpartyLast5
  ) {
    score += 30;
    reasons.push("匯款帳號末五碼一致");
  }
  const days = dateDistanceDays(transaction.transactionDate, submission.remitDate);
  if (days === 0) {
    score += 15;
    reasons.push("匯款日期一致");
  } else if (days != null && days <= 2) {
    score += 10;
    reasons.push(`匯款日期相差 ${days} 天`);
  }
  if (namesLookRelated(transaction.counterpartyName, submission.remitter)) {
    score += 5;
    reasons.push("匯款人名稱相近");
  }
  return { score, reasons };
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
    let bestSubmission: MatchingSubmission | null = null;
    let bestExtra = { score: 0, reasons: [] as string[] };
    for (const submission of submissionsByProject.get(target.projectId) ?? []) {
      const extra = scoreSubmission(transaction, submission);
      if (extra.score > bestExtra.score) {
        bestSubmission = submission;
        bestExtra = extra;
      }
    }
    score += bestExtra.score;
    reasons.push(...bestExtra.reasons);

    if (!bestSubmission && target.recipients.some((name) => namesLookRelated(name, transaction.counterpartyName))) {
      score += 5;
      reasons.push("匯款人與發票收款對象名稱相近");
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
      submissionId: bestSubmission?.id ?? null,
    });
  }

  return candidates
    .sort((a, b) => b.score - a.score || a.candidateKey.localeCompare(b.candidateKey))
    .slice(0, 3);
}
