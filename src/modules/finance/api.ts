/**
 * 財務模組 API
 * 資料來源：Supabase（PostgreSQL）
 */

export { getInvoices, getFinance, createInvoicesBatch, updateInvoiceById } from "@/lib/db/finance";
export type { InvoiceInsertInput } from "@/lib/db/finance";
