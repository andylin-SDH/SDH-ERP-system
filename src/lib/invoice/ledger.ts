/** 財政部電子發票字軌：兩碼英文 + 八碼數字 */
export function isEInvoiceTrackNumber(raw: string): boolean {
  return /^[A-Za-z]{2}\d{8}$/.test(String(raw ?? "").trim().replace(/\s+/g, ""));
}

export const INVOICE_VOID_MARK = "【已作廢】";

/** 光貿開立成功當下寫入；之後靠手動刷新更新，不輪詢 */
export const AMEGO_UPLOAD_STATUS_PROCESSING = "處理中";
export const AMEGO_UPLOAD_STATUS_COMPLETE = "完成";
export const AMEGO_UPLOAD_STATUS_VOIDED = "已作廢";
/** 作廢已送出，等使用者按刷新才再向光貿確認 */
export const AMEGO_UPLOAD_STATUS_VOID_PENDING = "作廢處理中";

export function invoiceIsVoided(row: { 作廢時間?: string | null; 備註?: string | null }): boolean {
  if (String(row.作廢時間 ?? "").trim()) return true;
  return String(row.備註 ?? "").includes(INVOICE_VOID_MARK);
}

/** 已終態：刷新時不再打光貿 */
export function invoiceAmegoStatusIsTerminal(row: {
  光貿上傳狀態?: string | null;
  作廢時間?: string | null;
  備註?: string | null;
}): boolean {
  if (invoiceIsVoided(row)) return true;
  const st = String(row.光貿上傳狀態 ?? "").trim();
  return st === AMEGO_UPLOAD_STATUS_COMPLETE || st === AMEGO_UPLOAD_STATUS_VOIDED;
}

/** 字軌發票且尚未完成／作廢 → 刷新時才查光貿 */
export function invoiceNeedsAmegoStatusRefresh(row: {
  發票號碼?: string | null;
  光貿上傳狀態?: string | null;
  作廢時間?: string | null;
  備註?: string | null;
}): boolean {
  if (!isEInvoiceTrackNumber(String(row.發票號碼 ?? ""))) return false;
  return !invoiceAmegoStatusIsTerminal(row);
}
