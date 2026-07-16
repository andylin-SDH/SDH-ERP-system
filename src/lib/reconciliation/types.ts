export type BankTransactionStatus = "unmatched" | "suggested" | "matched" | "ignored";
export type ReconciliationMatchStatus = "suggested" | "confirmed" | "rejected";

/** 前端解析 CSV 後送進 API 的標準格式。 */
export interface BankImportRow {
  transactionDate: string;
  bookingDate?: string | null;
  amount: string | number;
  currency?: string | null;
  direction?: "credit" | "debit";
  counterpartyName?: string | null;
  counterpartyAccount?: string | null;
  counterpartyLast5?: string | null;
  description?: string | null;
  bankReference?: string | null;
  sourceAccount?: string | null;
  raw?: Record<string, unknown>;
}

export interface MatchingBankTransaction {
  id: string;
  transactionDate: string;
  amount: number;
  direction: "credit" | "debit";
  counterpartyName: string;
  counterpartyLast5: string;
  description: string;
}

export interface MatchingInvoice {
  id: string;
  projectId: string;
  invoiceNumber: string;
  amount: number;
  recipient: string;
  paidDate: string;
}

export interface MatchingSubmission {
  id: string;
  projectId: string;
  remitDate: string;
  amount: number | null;
  last5: string;
  remitter: string;
}

export interface ReconciliationCandidate {
  candidateKey: string;
  transactionId: string;
  projectId: string;
  invoiceIds: string[];
  invoiceNumbers: string[];
  candidateAmount: number;
  score: number;
  reasons: string[];
  submissionId: string | null;
}

export interface ReconciliationDashboardMatch {
  id: string;
  projectId: string;
  projectName: string;
  invoiceIds: string[];
  invoiceNumbers: string[];
  candidateAmount: number;
  score: number;
  reasons: string[];
  status: ReconciliationMatchStatus;
  confirmedBy: string;
  confirmedAt: string;
}

export interface ReconciliationDashboardTransaction {
  id: string;
  transactionDate: string;
  bookingDate: string;
  amount: number;
  currency: string;
  counterpartyName: string;
  counterpartyLast5: string;
  description: string;
  status: BankTransactionStatus;
  matches: ReconciliationDashboardMatch[];
}

export interface ReconciliationDashboardRun {
  id: string;
  source: string;
  filename: string;
  rowCount: number;
  importedCount: number;
  duplicateCount: number;
  errorCount: number;
  createdBy: string;
  createdAt: string;
}

