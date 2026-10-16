import { NextResponse } from "next/server";
import { invoiceEInvoiceNotLiveResponse, isInvoiceEInvoiceLive } from "@/lib/invoice/launch";

/** 開立改走送審。這支保留，避免舊畫面直接打光貿。 */
export async function POST() {
  if (!isInvoiceEInvoiceLive()) return invoiceEInvoiceNotLiveResponse();
  return NextResponse.json(
    { ok: false, error: "請先送出審核。董事長或會計放行後才會開立。" },
    { status: 400 }
  );
}
