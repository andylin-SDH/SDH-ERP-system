/**
 * GET - 取得系統設定（需登入）
 * PUT - 更新系統設定（限董事長/管理者）
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireAdmin } from "@/lib/auth/api";
import { getSystemConfig, updateSystemConfig } from "@/lib/db/system-config";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const config = await getSystemConfig();
    return NextResponse.json({ ok: true, config });
  } catch (err) {
    console.error("GET /api/system-config error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await request.json()) as { key?: string; value?: unknown };
    const key = String(body?.key ?? "").trim();
    if (!key) {
      return NextResponse.json({ ok: false, error: "缺少 key" }, { status: 400 });
    }
    if (!["master_payout_defaults", "project_types", "role_visibility", "roles", "role_permissions"].includes(key)) {
      return NextResponse.json({ ok: false, error: "不允許的 key" }, { status: 400 });
    }
    await updateSystemConfig(key, body.value);
    const config = await getSystemConfig();
    return NextResponse.json({ ok: true, config });
  } catch (err) {
    console.error("PUT /api/system-config error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
