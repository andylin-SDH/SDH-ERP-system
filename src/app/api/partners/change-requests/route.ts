/**
 * 已上架 KOL 變更申請：核准＝合併回 partners；駁回＝標記未通過
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, ADMIN_ROLES } from "@/lib/auth/api";
import {
  approveChangeRequest,
  rejectChangeRequest,
} from "@/lib/db/partner-change-requests";

function isAdmin(role: string) {
  return ADMIN_ROLES.includes(role as (typeof ADMIN_ROLES)[number]);
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  if (!isAdmin(auth.user.role)) {
    return NextResponse.json({ ok: false, error: "僅董事長／管理者可操作" }, { status: 403 });
  }
  try {
    const body = (await request.json()) as {
      id?: string;
      action?: "approve" | "reject";
      駁回理由?: string | null;
    };
    const id = String(body?.id ?? "").trim();
    if (!id) return NextResponse.json({ ok: false, error: "id 為必填" }, { status: 400 });
    if (body?.action === "approve") {
      const partner = await approveChangeRequest(id);
      if (!partner) return NextResponse.json({ ok: false, error: "核准失敗或申請已不存在" }, { status: 404 });
      return NextResponse.json({ ok: true, partner });
    }
    if (body?.action === "reject") {
      const ok = await rejectChangeRequest(id, body.駁回理由 ?? null);
      if (!ok) return NextResponse.json({ ok: false, error: "駁回失敗" }, { status: 400 });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ ok: false, error: "action 須為 approve 或 reject" }, { status: 400 });
  } catch (e) {
    console.error("PATCH change-requests error:", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "失敗" },
      { status: 500 }
    );
  }
}
