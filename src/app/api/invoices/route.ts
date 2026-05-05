import { NextRequest, NextResponse } from "next/server";
import { getInvoices } from "@/modules/finance";
import { createInvoicesBatch, deleteInvoicesByIds, updateInvoiceById, type InvoiceInsertInput } from "@/lib/db/finance";
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

/**
 * PATCH：更新單筆發票
 * Body: { id: string } & InvoiceInsertInput（須含發票號碼等完整可編輯欄位）
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await request.json()) as ({ id?: string } & InvoiceInsertInput) | null;
    const id = body?.id != null ? String(body.id).trim() : "";
    if (!id) {
      return NextResponse.json({ ok: false, error: "缺少發票 id" }, { status: 400 });
    }
    const rest = { ...(body ?? {}) } as Record<string, unknown>;
    delete rest.id;
    const updated = await updateInvoiceById(id, rest as InvoiceInsertInput);
    return NextResponse.json({ ok: true, invoice: updated });
  } catch (error) {
    console.error("PATCH /api/invoices error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "更新發票失敗" },
      { status: 500 }
    );
  }
}

/**
 * DELETE：批量刪除發票
 * Body: { ids: string[] }
 */
export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await request.json()) as { ids?: string[] } | null;
    const ids = Array.isArray(body?.ids) ? body.ids : [];
    if (ids.length === 0) {
      return NextResponse.json({ ok: false, error: "請提供 ids 陣列" }, { status: 400 });
    }
    const count = await deleteInvoicesByIds(ids);
    return NextResponse.json({ ok: true, count });
  } catch (error) {
    console.error("DELETE /api/invoices error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "刪除發票失敗" },
      { status: 500 }
    );
  }
}
