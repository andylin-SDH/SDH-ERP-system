import { NextRequest, NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth/api";
import { createInvoiceRequest, listInvoiceRequests, type InvoiceRequestLine } from "@/lib/db/invoice-requests";
import { invoiceEInvoiceNotLiveResponse, isInvoiceEInvoiceLive } from "@/lib/invoice/launch";
import { canReviewInvoice } from "@/lib/invoice/review-access";
import type { B2bPriceMode, B2bTaxKind } from "@/lib/invoice/b2b-amount";

function num(raw: unknown): number {
  const n = Number(String(raw ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : NaN;
}

export async function GET(request: NextRequest) {
  const auth = await requireEmployee(request);
  if (auth instanceof NextResponse) return auth;
  if (!isInvoiceEInvoiceLive()) return invoiceEInvoiceNotLiveResponse();
  try {
    const mine = canReviewInvoice(auth.user.role) ? undefined : auth.user.email;
    const requests = await listInvoiceRequests(mine);
    return NextResponse.json({ ok: true, requests, canReview: canReviewInvoice(auth.user.role) });
  } catch (error) {
    console.error("GET /api/invoices/amego/requests error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "無法讀取申請" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireEmployee(request);
  if (auth instanceof NextResponse) return auth;
  if (!isInvoiceEInvoiceLive()) return invoiceEInvoiceNotLiveResponse();
  try {
    const body = (await request.json()) as {
      projectId?: string;
      buyerIdentifier?: string;
      buyerName?: string;
      buyerEmail?: string;
      buyerAddress?: string;
      remark?: string;
      taxKind?: B2bTaxKind;
      priceMode?: B2bPriceMode;
      customsClearanceMark?: number;
      zeroTaxRateReason?: number;
      items?: Array<{ description?: string; quantity?: number | string; unitPrice?: number | string }>;
    };
    const buyerIdentifier = String(body.buyerIdentifier ?? "").trim();
    const buyerName = String(body.buyerName ?? "").trim();
    const buyerEmail = String(body.buyerEmail ?? "").trim();
    const remark = String(body.remark ?? "").trim();
    if (!/^\d{8}$/.test(buyerIdentifier) || /^0+$/.test(buyerIdentifier)) {
      return NextResponse.json({ ok: false, error: "買受人統編須為 8 碼數字" }, { status: 400 });
    }
    if (!buyerName || /^0+$/.test(buyerName)) {
      return NextResponse.json({ ok: false, error: "請填買受人名稱" }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) {
      return NextResponse.json({ ok: false, error: "請填買受人 Email" }, { status: 400 });
    }
    if (remark.length > 200) {
      return NextResponse.json({ ok: false, error: "發票備註不可超過 200 字" }, { status: 400 });
    }
    const items: InvoiceRequestLine[] = (Array.isArray(body.items) ? body.items : []).map((item) => ({
      description: String(item.description ?? "").trim(),
      quantity: num(item.quantity),
      unitPrice: num(item.unitPrice),
    }));
    if (items.some((item) => item.description.length > 256)) {
      return NextResponse.json({ ok: false, error: "品名不可超過 256 字" }, { status: 400 });
    }
    const created = await createInvoiceRequest({
      projectId: String(body.projectId ?? "").trim(),
      buyerIdentifier,
      buyerName,
      buyerEmail,
      buyerAddress: String(body.buyerAddress ?? "").trim(),
      remark,
      taxKind: body.taxKind === "zero" || body.taxKind === "exempt" ? body.taxKind : "taxable",
      priceMode: body.priceMode === "taxed" ? "taxed" : "untaxed",
      customsClearanceMark: body.customsClearanceMark,
      zeroTaxRateReason: body.zeroTaxRateReason,
      items,
      申請人Email: auth.user.email,
      申請人: auth.user.name || auth.user.email,
    });
    return NextResponse.json({ ok: true, request: created });
  } catch (error) {
    console.error("POST /api/invoices/amego/requests error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "送審失敗" },
      { status: 500 }
    );
  }
}
