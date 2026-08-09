/**
 * 專案額外獎金 API（分潤類型＝額外獎金）
 * GET：依專案ID 列出
 * POST：新增
 * PATCH：更新領取人／金額
 * DELETE：刪除
 * 僅董事長、會計可寫入
 */

import { NextRequest, NextResponse } from "next/server";
import { requireEmployee, requireExtraBonusEditor } from "@/lib/auth/api";
import {
  createExtraBonus,
  deleteExtraBonus,
  listExtraBonusesBy專案ID,
  updateExtraBonus,
} from "@/lib/db/payout";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireEmployee(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const 專案ID = String(request.nextUrl.searchParams.get("專案ID") ?? "").trim();
    if (!專案ID) {
      return NextResponse.json({ ok: false, error: "缺少專案ID" }, { status: 400 });
    }
    const list = await listExtraBonusesBy專案ID(專案ID);
    return NextResponse.json({ ok: true, list });
  } catch (error) {
    console.error("GET /api/payout/extra-bonus error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "讀取失敗" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireExtraBonusEditor(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await request.json()) as {
      專案ID?: string;
      領取人?: string;
      分潤金額?: string;
    } | null;
    const row = await createExtraBonus({
      專案ID: String(body?.專案ID ?? ""),
      領取人: String(body?.領取人 ?? ""),
      分潤金額: String(body?.分潤金額 ?? ""),
    });
    return NextResponse.json({ ok: true, payout: row });
  } catch (error) {
    console.error("POST /api/payout/extra-bonus error:", error);
    const msg = error instanceof Error ? error.message : "新增失敗";
    const status = /缺少|請選擇|須大於/.test(msg) ? 400 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireExtraBonusEditor(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await request.json()) as {
      id?: string;
      領取人?: string;
      分潤金額?: string;
    } | null;
    const id = String(body?.id ?? "").trim();
    if (!id) {
      return NextResponse.json({ ok: false, error: "缺少 id" }, { status: 400 });
    }
    const row = await updateExtraBonus(id, {
      領取人: body?.領取人,
      分潤金額: body?.分潤金額,
    });
    if (!row) {
      return NextResponse.json({ ok: false, error: "找不到該額外獎金列" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, payout: row });
  } catch (error) {
    console.error("PATCH /api/payout/extra-bonus error:", error);
    const msg = error instanceof Error ? error.message : "更新失敗";
    const status = /僅可編輯|請選擇|須大於/.test(msg) ? 400 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireExtraBonusEditor(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await request.json()) as { id?: string } | null;
    const id = String(body?.id ?? "").trim();
    if (!id) {
      return NextResponse.json({ ok: false, error: "缺少 id" }, { status: 400 });
    }
    const ok = await deleteExtraBonus(id);
    if (!ok) {
      return NextResponse.json({ ok: false, error: "找不到該額外獎金列" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/payout/extra-bonus error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "刪除失敗" },
      { status: 500 }
    );
  }
}
