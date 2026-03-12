export const dynamic = "force-dynamic";

/**
 * 除錯：合作夥伴列表為何被篩成 0
 * GET /api/debug/partners-visibility
 * 需登入；回傳 DB 原始 match_fields、正規化後、總筆數、篩選後筆數、原因與前 3 筆比對欄位值
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/api";
import { buildPartnersVisibilityDebug } from "@/lib/debug/partners-visibility-debug";
import { log } from "@/lib/log";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const payload = await buildPartnersVisibilityDebug(auth.user);
    log("debug.partners-visibility", "GET 除錯快照", {
      role: payload.user.role,
      partnersTotal: payload.partnersTotal,
      partnersFilteredCount: payload.partnersFilteredCount,
      filterReason: payload.filterReason,
      rulesPartnersMatchFields: payload.rulesPartnersMatchFields,
      dbRawMatchFields: payload.dbPartnersRow?.match_fields,
    });
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("debug.partners-visibility", "GET 失敗", { error: msg });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
