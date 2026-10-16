import { NextRequest, NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth/api";
import { approveInvoiceRequest, rejectInvoiceRequest } from "@/lib/db/invoice-requests";
import { invoiceEInvoiceNotLiveResponse, isInvoiceEInvoiceLive } from "@/lib/invoice/launch";
import { canReviewInvoice } from "@/lib/invoice/review-access";

export async function POST(request: NextRequest) {
  const auth = await requireEmployee(request);
  if (auth instanceof NextResponse) return auth;
  if (!isInvoiceEInvoiceLive()) return invoiceEInvoiceNotLiveResponse();
  if (!canReviewInvoice(auth.user.role)) {
    return NextResponse.json({ ok: false, error: "只有董事長和會計可以審核" }, { status: 403 });
  }
  try {
    const body = (await request.json()) as { id?: string; action?: string; reason?: string };
    const id = String(body.id ?? "").trim();
    if (!id) return NextResponse.json({ ok: false, error: "缺少申請" }, { status: 400 });
    const reviewer = auth.user.name || auth.user.email;
    if (body.action === "reject") {
      const reason = String(body.reason ?? "").trim();
      if (!reason) return NextResponse.json({ ok: false, error: "請填退回原因" }, { status: 400 });
      const updated = await rejectInvoiceRequest(id, reason, reviewer);
      return NextResponse.json({ ok: true, request: updated });
    }
    if (body.action === "approve") {
      const updated = await approveInvoiceRequest(id, reviewer);
      return NextResponse.json({ ok: true, request: updated });
    }
    return NextResponse.json({ ok: false, error: "未知的審核動作" }, { status: 400 });
  } catch (error) {
    console.error("POST /api/invoices/amego/requests/review error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "審核失敗" },
      { status: 500 }
    );
  }
}
