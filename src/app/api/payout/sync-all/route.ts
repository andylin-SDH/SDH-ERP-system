/**
 * POST：依大總表重算全部分潤金額（限董事長/管理者）
 * 先回應再背景執行，避免逾時
 */

import { NextRequest, NextResponse, after } from "next/server";
import { requireAdmin } from "@/lib/auth/api";
import { runPayoutResyncAndMarkCurrent } from "@/lib/db/payout";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  after(async () => {
    try {
      await runPayoutResyncAndMarkCurrent();
    } catch (e) {
      console.error("POST /api/payout/sync-all background error:", e);
    }
  });
  return NextResponse.json({ ok: true, queued: true });
}
