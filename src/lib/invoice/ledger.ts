/** 財政部電子發票字軌：兩碼英文 + 八碼數字 */
export function isEInvoiceTrackNumber(raw: string): boolean {
  return /^[A-Za-z]{2}\d{8}$/.test(String(raw ?? "").trim().replace(/\s+/g, ""));
}

export const INVOICE_VOID_MARK = "【已作廢】";

export function invoiceIsVoided(row: { 作廢時間?: string | null; 備註?: string | null }): boolean {
  if (String(row.作廢時間 ?? "").trim()) return true;
  return String(row.備註 ?? "").includes(INVOICE_VOID_MARK);
}
