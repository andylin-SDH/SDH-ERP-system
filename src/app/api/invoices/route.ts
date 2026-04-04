import { NextRequest, NextResponse } from "next/server";
import { getInvoices } from "@/modules/finance";
import { createInvoicesBatch, type InvoiceInsertInput } from "@/lib/db/finance";
import { requireAuth } from "@/lib/auth/api";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const invoices = await getInvoices();
    return NextResponse.json({ ok: true, invoices });
  } catch (error) {
    console.error("GET /api/invoices error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

/**
 * POST：批次新增發票
 * Body: { invoices: InvoiceInsertInput[] }（至少一筆須含發票號碼；專案ID 可省略）
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await request.json()) as { invoices?: InvoiceInsertInput[] } | null;
    const raw = body?.invoices;
    if (!Array.isArray(raw) || raw.length === 0) {
      return NextResponse.json({ ok: false, error: "請提供 invoices 陣列" }, { status: 400 });
    }
    const created = await createInvoicesBatch(raw);
    return NextResponse.json({ ok: true, invoices: created, count: created.length });
  } catch (error) {
    console.error("POST /api/invoices error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "新增發票失敗" },
      { status: 500 }
    );
  }
}
