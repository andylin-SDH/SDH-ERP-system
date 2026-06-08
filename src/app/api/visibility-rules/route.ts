export const dynamic = "force-dynamic";

/**
 * 資料可見規則 API
 * GET - 取得規則（需登入）
 * PUT - 更新規則（限董事長/管理者）
 */

import { NextRequest, NextResponse } from "next/server";
import { getVisibilityRules, updateVisibilityRules } from "@/lib/db/visibility-rules";
import { requireAdmin, requireEmployee } from "@/lib/auth/api";

export async function GET(request: NextRequest) {
  const auth = await requireEmployee(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const rules = await getVisibilityRules();
    return NextResponse.json(
      { ok: true, rules },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
    );
  } catch (e) {
    console.error("GET /api/visibility-rules error:", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await request.json()) as { rules?: Record<string, string[]> };
    const rules = body?.rules && typeof body.rules === "object" ? body.rules : {};
    const updated = await updateVisibilityRules(rules);
    return NextResponse.json({ ok: true, rules: updated });
  } catch (e) {
    const err = e as { message?: string; code?: string };
    const msg = err?.message ?? (e instanceof Error ? e.message : "更新失敗");
    console.error("PUT /api/visibility-rules error:", e);
    return NextResponse.json(
      { ok: false, error: msg },
      { status: 500 }
    );
  }
}
