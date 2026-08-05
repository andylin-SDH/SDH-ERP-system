import { NextRequest, NextResponse } from "next/server";
import { requireKolPortalPreview } from "@/lib/auth/api";
import {
  buildKolPortalDataByPartnerId,
  listKolPortalPreviewOptions,
} from "@/lib/kol/portal-data";

export const dynamic = "force-dynamic";

/**
 * GET /api/kol/preview
 * - 無參數：可預覽的 KOL 清單（有掛名專案者）
 * - ?partnerId=：該 KOL 老師入口唯讀資料
 */
export async function GET(request: NextRequest) {
  const auth = await requireKolPortalPreview(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const partnerId = String(request.nextUrl.searchParams.get("partnerId") ?? "").trim();
    if (!partnerId) {
      const options = await listKolPortalPreviewOptions();
      return NextResponse.json({ ok: true, options });
    }

    const data = await buildKolPortalDataByPartnerId(partnerId, { forceReadOnly: true });
    if (!data.ok) {
      return NextResponse.json({ ok: false, error: data.error }, { status: 400 });
    }
    return NextResponse.json({
      ok: true,
      preview: true,
      partnerId: data.partnerId,
      partnerName: data.partnerName,
      laborProfile: data.laborProfile,
      projects: data.projects,
    });
  } catch (e) {
    console.error("GET /api/kol/preview", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "讀取失敗" },
      { status: 500 }
    );
  }
}
