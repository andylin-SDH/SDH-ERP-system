import { NextRequest, NextResponse } from "next/server";
import {
  createPaymentRecordsBatch,
  getPaymentRecords,
  updatePaymentRecordById,
  type PaymentRecordInput,
} from "@/lib/db/finance";
import { requireAuth } from "@/lib/auth/api";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const payments = await getPaymentRecords();
    return NextResponse.json({ ok: true, payments });
  } catch (error) {
    console.error("GET /api/finance-payments error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await request.json()) as { payments?: PaymentRecordInput[]; allowBlank?: boolean } | null;
    const raw = body?.payments;
    if (!Array.isArray(raw) || raw.length === 0) {
      return NextResponse.json({ ok: false, error: "請提供 payments 陣列" }, { status: 400 });
    }
    const created = await createPaymentRecordsBatch(raw, { allowBlank: Boolean(body?.allowBlank) });
    return NextResponse.json({ ok: true, payments: created, count: created.length });
  } catch (error) {
    console.error("POST /api/finance-payments error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "新增付款記錄失敗" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await request.json()) as ({ id?: string } & PaymentRecordInput) | null;
    const id = body?.id != null ? String(body.id).trim() : "";
    if (!id) {
      return NextResponse.json({ ok: false, error: "缺少付款記錄 id" }, { status: 400 });
    }
    const rest = { ...(body ?? {}) } as Record<string, unknown>;
    delete rest.id;
    const updated = await updatePaymentRecordById(id, rest as PaymentRecordInput);
    return NextResponse.json({ ok: true, payment: updated });
  } catch (error) {
    console.error("PATCH /api/finance-payments error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "更新付款記錄失敗" },
      { status: 500 }
    );
  }
}
