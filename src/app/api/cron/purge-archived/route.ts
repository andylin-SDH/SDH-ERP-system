/**
 * 排程：封存滿 ARCHIVE_RETENTION_DAYS（預設 30）天後永久清除主檔
 * 驗證：Authorization: Bearer CRON_SECRET 或 ?secret=
 * 每日會隨「長期案任務模板」cron 一併執行；此路徑可供手動測試。
 */

import { NextRequest, NextResponse } from "next/server";
import { purgeExpiredArchives } from "@/lib/db/purge-archived";

export const dynamic = "force-dynamic";

function verifyCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  const q = req.nextUrl.searchParams.get("secret");
  return q === secret;
}

export async function GET(request: NextRequest) {
  if (!verifyCron(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await purgeExpiredArchives();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("GET /api/cron/purge-archived", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
