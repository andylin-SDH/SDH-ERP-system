import { NextResponse } from "next/server";

/** 台北時間這一天 00:00 起開放電子發票開立／審核（財務「發票清冊」手動維護不受影響） */
export const INVOICE_E_INVOICE_LAUNCH_YMD = "2026-11-01";

function launchYmd(): string {
  const fromEnv = String(process.env.NEXT_PUBLIC_INVOICE_E_INVOICE_LAUNCH ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(fromEnv) ? fromEnv : INVOICE_E_INVOICE_LAUNCH_YMD;
}

function forceOpen(): boolean {
  return (
    String(process.env.NEXT_PUBLIC_INVOICE_E_INVOICE_FORCE_OPEN ?? "").trim() === "1" ||
    String(process.env.INVOICE_E_INVOICE_FORCE_OPEN ?? "").trim() === "1"
  );
}

/** 台北日曆 YYYY-MM-DD */
export function taipeiYmd(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function isInvoiceEInvoiceLive(now = new Date()): boolean {
  if (forceOpen()) return true;
  return taipeiYmd(now) >= launchYmd();
}

export function invoiceEInvoiceLaunchLabel(): string {
  const [y, m, d] = launchYmd().split("-");
  return `${y}/${Number(m)}/${Number(d)}`;
}

export function invoiceEInvoiceLockedMessage(): string {
  return `電子發票功能將於 ${invoiceEInvoiceLaunchLabel()} 開放。`;
}

/** API 未開通時統一回 403 */
export function invoiceEInvoiceNotLiveResponse(): NextResponse {
  return NextResponse.json(
    { ok: false, code: "invoice_not_live", error: invoiceEInvoiceLockedMessage() },
    { status: 403 }
  );
}
