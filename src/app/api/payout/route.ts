/**
 * 分潤表 API
 * GET：取得分潤表列表（需登入）
 */

import { NextRequest, NextResponse } from "next/server";
import { getPayoutList } from "@/lib/db/payout";
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
