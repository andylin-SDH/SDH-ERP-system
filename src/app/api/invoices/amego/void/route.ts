import { NextRequest, NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth/api";
import { markInvoicesVoided } from "@/lib/db/finance";
import { voidInvoice } from "@/lib/invoice/amego";
import { isEInvoiceTrackNumber } from "@/lib/invoice/ledger";

/** 作廢不套 11/1 開立閘門：清冊上已有字軌發票時，仍須能作廢，以免卡住進行中對帳。 */
export async function POST(request: NextRequest) {
  const auth = await requireEmployee(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = (await request.json()) as { invoiceNumber?: string; reason?: string };
    const invoiceNumber = String(body.invoiceNumber ?? "").trim().toUpperCase();
    const reason = String(body.reason ?? "").trim();
    if (!isEInvoiceTrackNumber(invoiceNumber)) {
      return NextResponse.json({ ok: false, error: "只有字軌發票（兩碼英文加八碼數字）可以作廢" }, { status: 400 });
    }
    if (!reason || reason.length > 20) {
      return NextResponse.json({ ok: false, error: "請填作廢原因，最多 20 字" }, { status: 400 });
    }

    await voidInvoice(invoiceNumber, reason);
    const invoices = await markInvoicesVoided(invoiceNumber, reason);
    return NextResponse.json({ ok: true, invoiceNumber, invoices });
  } catch (error) {
    console.error("POST /api/invoices/amego/void error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "作廢發票失敗" },
      { status: 500 }
    );
  }
}
