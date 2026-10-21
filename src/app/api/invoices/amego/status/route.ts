import { NextRequest, NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth/api";
import {
  amegoCanVoid,
  amegoStatusLabel,
  amegoTypeLabel,
  amegoVoidBlockReason,
  getInvoiceStatus,
} from "@/lib/invoice/amego";
import { isEInvoiceTrackNumber } from "@/lib/invoice/ledger";

/** 按需查光貿上傳狀態。不清冊輪詢；作廢前由前端點一次再打這支。 */
export async function POST(request: NextRequest) {
  const auth = await requireEmployee(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = (await request.json()) as { invoiceNumber?: string };
    const invoiceNumber = String(body.invoiceNumber ?? "").trim().toUpperCase();
    if (!isEInvoiceTrackNumber(invoiceNumber)) {
      return NextResponse.json({ ok: false, error: "只有字軌發票（兩碼英文加八碼數字）可查光貿狀態" }, { status: 400 });
    }

    const status = await getInvoiceStatus(invoiceNumber);
    const blockReason = amegoVoidBlockReason(status);
    return NextResponse.json({
      ok: true,
      invoiceNumber: status.invoiceNumber,
      type: status.type,
      typeLabel: amegoTypeLabel(status.type),
      status: status.status,
      statusLabel: amegoStatusLabel(Number(status.status)),
      totalAmount: status.totalAmount,
      canVoid: amegoCanVoid(status),
      blockReason,
    });
  } catch (error) {
    console.error("POST /api/invoices/amego/status error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "查詢光貿狀態失敗" },
      { status: 500 }
    );
  }
}
