/**
 * POST /api/partners/restore — 還原已軟刪 KOL（董事長／管理者）
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/api";
import { restorePartner } from "@/lib/db/partners";
import { partnerEditorLabel } from "@/lib/partners/editor-label";

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = (await request.json().catch(() => ({}))) as { PartnerID?: string } | null;
    const PartnerID = String(body?.PartnerID ?? "").trim();
    if (!PartnerID) {
      return NextResponse.json({ ok: false, error: "PartnerID 為必填" }, { status: 400 });
    }
    const editor = partnerEditorLabel(auth.user);
    const result = await restorePartner(PartnerID, editor);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error ?? "還原失敗" }, { status: 400 });
    }
    return NextResponse.json({ ok: true, partner: result.partner, PartnerID });
  } catch (error) {
    console.error("POST /api/partners/restore error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "還原失敗" },
      { status: 500 }
    );
  }
}
