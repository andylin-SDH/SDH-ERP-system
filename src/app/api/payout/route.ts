/**
 * 分潤表 API
 * GET：取得分潤表列表
 * PATCH：更新單筆「分潤匯款日期」（財務逐列標記已付款）
 */

import { NextRequest, NextResponse } from "next/server";
import { getPayoutList, updatePayoutRemitDate, todayDateStringLocal } from "@/lib/db/payout";
import { requireAuth } from "@/lib/auth/api";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const list = await getPayoutList();
    return NextResponse.json({ ok: true, list });
  } catch (error) {
    console.error("GET /api/payout error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await request.json()) as {
      id?: string;
      分潤匯款日期?: string | null;
      markPaid?: boolean;
      clearPaid?: boolean;
    } | null;
    const id = String(body?.id ?? "").trim();
    if (!id) {
      return NextResponse.json({ ok: false, error: "缺少分潤列 id" }, { status: 400 });
    }

    let remit: string | null;
    if (body?.clearPaid) {
      remit = null;
    } else if (body?.markPaid) {
      remit = todayDateStringLocal();
    } else if (body?.分潤匯款日期 !== undefined) {
      const s = body.分潤匯款日期;
      remit = s == null || String(s).trim() === "" ? null : String(s).trim();
    } else {
      return NextResponse.json({ ok: false, error: "請提供 markPaid、clearPaid 或 分潤匯款日期" }, { status: 400 });
    }

    const row = await updatePayoutRemitDate(id, remit);
    if (!row) {
      return NextResponse.json({ ok: false, error: "更新失敗或找不到該分潤列" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, payout: row });
  } catch (error) {
    console.error("PATCH /api/payout error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "更新失敗" },
      { status: 500 }
    );
  }
}
