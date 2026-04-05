import { NextRequest, NextResponse } from "next/server";
import { getFinance } from "@/modules/finance";
import { requireAuth } from "@/lib/auth/api";
import { syncAllFinanceFromMaster, updateFinanceBy專案ID, type FinanceUpdateFields } from "@/lib/db/finance";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  try {
    await syncAllFinanceFromMaster();
    const finance = await getFinance();
    return NextResponse.json({ ok: true, finance });
  } catch (error) {
    console.error("GET /api/finance error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

/**
 * PATCH：依專案ID 更新財務列（可編欄位）
 * Body: { 專案ID: string, 廠商付款日期?, 員工分潤日期? }（僅此二欄可寫）
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await request.json()) as ({ 專案ID?: string } & FinanceUpdateFields) | null;
    const 專案ID = body?.專案ID != null ? String(body.專案ID).trim() : "";
    if (!專案ID) {
      return NextResponse.json({ ok: false, error: "缺少專案ID" }, { status: 400 });
    }
    const finance = await updateFinanceBy專案ID(專案ID, {
      廠商付款日期: body?.廠商付款日期,
      員工分潤日期: body?.員工分潤日期,
    });
    return NextResponse.json({ ok: true, finance });
  } catch (error) {
    console.error("PATCH /api/finance error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "更新財務失敗" },
      { status: 500 }
    );
  }
}
