import { NextRequest, NextResponse } from "next/server";
import { requireKol } from "@/lib/auth/api";
import { buildKolPortalData } from "@/lib/kol/portal-data";

export const dynamic = "force-dynamic";

/**
 * KOL（老師）專用只讀總覽：專案、結帳狀態（依財務入帳日期）、發票含稅合計
 */
export async function GET(request: NextRequest) {
  const auth = await requireKol(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const data = await buildKolPortalData(auth.user);
    if (!data.ok) {
      return NextResponse.json({ ok: false, error: data.error }, { status: 400 });
    }
    return NextResponse.json({
      ok: true,
      partnerId: data.partnerId,
      partnerName: data.partnerName,
      laborProfile: data.laborProfile,
      projects: data.projects,
    });
  } catch (e) {
    console.error("GET /api/kol/overview", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "讀取失敗" },
      { status: 500 }
    );
  }
}
