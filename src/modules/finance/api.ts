/**
 * 財務模組 API
 * 資料來源：Supabase（PostgreSQL）
 */

export {
  getInvoices,
  sortInvoicesByInvoiceNumber,
  getFinance,
  getPaymentRecords,
  createInvoicesBatch,
  updateInvoiceById,
  createPaymentRecordsBatch,
  updatePaymentRecordById,
} from "@/lib/db/finance";
export type { InvoiceInsertInput, PaymentRecordInput } from "@/lib/db/finance";
