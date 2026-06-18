/**
 * 排程：長期案任務模板自動建立任務（每日）
 * 驗證：Authorization: Bearer CRON_SECRET 或 ?secret=
 */

import { NextRequest, NextResponse } from "next/server";
import { runMasterTaskTemplatesForToday } from "@/lib/master-task-template-run";

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
    const result = await runMasterTaskTemplatesForToday();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("GET /api/cron/master-task-templates", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
