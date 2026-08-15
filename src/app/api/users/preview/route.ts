/**
 * GET /api/users/preview?email=
 * 董事長／管理者：取得目標使用者資料 + 可見範圍（供 Dashboard 唯讀預覽）
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, KOL_ROLE } from "@/lib/auth/api";
import { getUserByEmail } from "@/modules/users";
import { getUserVisibility } from "@/lib/db/user-visibility";
import { resolveKolPartnerForUser } from "@/lib/kol/partner-bind";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  const email = String(request.nextUrl.searchParams.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (!email) {
    return NextResponse.json({ ok: false, error: "請提供 email 參數" }, { status: 400 });
  }

  try {
    const user = await getUserByEmail(email);
    if (!user) {
      return NextResponse.json({ ok: false, error: "找不到該使用者" }, { status: 404 });
    }

    const role = String(user.role ?? "").trim();
    if (role === KOL_ROLE) {
      const bound = await resolveKolPartnerForUser(user);
      return NextResponse.json({
        ok: true,
        user: {
          email: user.email,
          name: user.name,
          role: user.role,
          dept: user.dept,
          scope: user.scope,
          activeFlag: user.activeFlag,
        },
        visibility: { tables: [], columns: {}, overview_kpis: null },
        kolPreview: bound.ok
          ? { partnerId: bound.binding.partnerId, partnerName: bound.binding.partnerName }
          : { partnerId: null, partnerName: null, error: bound.error },
      });
    }

    const visibility = await getUserVisibility(email);
    return NextResponse.json({
      ok: true,
      user: {
        email: user.email,
        name: user.name,
        role: user.role,
        dept: user.dept,
        scope: user.scope,
        activeFlag: user.activeFlag,
      },
      visibility: visibility
        ? {
            tables: visibility.tables,
            columns: visibility.columns,
            overview_kpis: visibility.overview_kpis,
          }
        : { tables: [], columns: {}, overview_kpis: null },
    });
  } catch (e) {
    console.error("GET /api/users/preview error:", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "讀取失敗" },
      { status: 500 }
    );
  }
}
