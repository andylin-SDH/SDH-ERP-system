import { NextResponse } from "next/server";
import { getPartnersApprovedWithError } from "@/lib/db/partners";

export const dynamic = "force-dynamic";

/**
 * 公開 KOL 牆資料（僅已核准），供對外前端讀取
 * GET /api/partners/gallery
 */
export async function GET() {
  try {
    const { partners, error } = await getPartnersApprovedWithError();
    const items = partners.map((p) => ({
      partnerId: p.PartnerID ?? "",
      name: p.合作夥伴名稱 ?? "",
      avatarUrl: p.形象照 ?? null,
      grade: p.分級 ?? null,
      category1: p.類別一 ?? null,
      category2: p.類別二 ?? null,
      category3: p.類別三 ?? null,
      followers: p.粉絲數 ?? null,
      channel: p["頻道｜節目名稱"] ?? null,
      social: p.社群網站 ?? null,
      email: p.Email ?? null,
    }));
    return NextResponse.json({
      ok: true,
      count: items.length,
      partners: items,
      ...(error ? { partnersError: error } : {}),
    });
  } catch (error) {
    console.error("GET /api/partners/gallery error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "讀取失敗" },
      { status: 500 }
    );
  }
}
