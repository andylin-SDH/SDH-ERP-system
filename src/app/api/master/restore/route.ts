/**
 * POST /api/master/restore — 還原已軟刪專案（僅董事長）
 */

import { NextRequest, NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth/api";
import { restoreMasterProjectByRowId, restoreMasterProjectBy專案ID } from "@/lib/db/master-project-delete";
import { partnerEditorLabel } from "@/lib/partners/editor-label";

export async function POST(request: NextRequest) {
  const auth = await requireEmployee(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.user.role !== "董事長") {
    return NextResponse.json({ ok: false, error: "僅董事長可還原專案" }, { status: 403 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      id?: string;
      專案ID?: string;
    } | null;
    const id = String(body?.id ?? "").trim();
    const 專案ID = String(body?.專案ID ?? "").trim();
    const editor = partnerEditorLabel(auth.user);

    if (id) {
      const result = await restoreMasterProjectByRowId(id, editor);
      return NextResponse.json({ ok: true, ...result });
    }
    if (專案ID) {
      const result = await restoreMasterProjectBy專案ID(專案ID, editor);
      return NextResponse.json({ ok: true, ...result });
    }
    return NextResponse.json({ ok: false, error: "id 或 專案ID 為必填" }, { status: 400 });
  } catch (error) {
    console.error("POST /api/master/restore error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "還原失敗" },
      { status: 500 }
    );
  }
}
