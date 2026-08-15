/**
 * GET /api/audit-logs — 董事長專用異動紀錄（KOL + 大總表）
 */

import { NextRequest, NextResponse } from "next/server";
import { requireChairman } from "@/lib/auth/api";
import { listUnifiedAuditLogs, type AuditEntityType } from "@/lib/db/audit-log";

export async function GET(request: NextRequest) {
  const auth = await requireChairman(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const entity = String(searchParams.get("entity") ?? "all").trim() as AuditEntityType | "all";
    const action = String(searchParams.get("action") ?? "").trim();
    const q = String(searchParams.get("q") ?? "").trim();
    const limit = Number(searchParams.get("limit") ?? "150");

    const logs = await listUnifiedAuditLogs({
      limit: Number.isFinite(limit) ? limit : 150,
      entityType: entity === "partners" || entity === "master" ? entity : "all",
      action: action || undefined,
      q: q || undefined,
    });

    return NextResponse.json({ ok: true, logs });
  } catch (error) {
    console.error("GET /api/audit-logs error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "讀取失敗" },
      { status: 500 }
    );
  }
}
