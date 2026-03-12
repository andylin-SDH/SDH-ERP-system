import { NextRequest, NextResponse } from "next/server";
import { getPartnersWithError } from "@/lib/db/partners";
import { createPartner, updatePartner, type NewPartnerInput, type UpdatePartnerInput } from "@/lib/db/partners";
import { requireAdmin, requireAuth } from "@/lib/auth/api";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const { partners, error: partnersError, usedFallback } = await getPartnersWithError();
    return NextResponse.json({
      ok: true,
      partners,
      ...(partnersError ? { partnersError, usedFallback } : {}),
    });
  } catch (error) {
    console.error("GET /api/partners error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await request.json()) as Partial<NewPartnerInput> | null;
    const PartnerID = String(body?.PartnerID ?? "").trim();
    if (!PartnerID) {
      return NextResponse.json({ ok: false, error: "PartnerID 為必填" }, { status: 400 });
    }

    const partner = await createPartner({
      PartnerID,
      類別一: body?.類別一,
      類別二: body?.類別二,
      類別三: body?.類別三,
      合作夥伴名稱: body?.合作夥伴名稱,
      社群網站: body?.社群網站,
      粉絲數: body?.粉絲數,
      "頻道｜節目名稱": body?.["頻道｜節目名稱"],
      "是否有經營 私域群": Boolean(body?.["是否有經營 私域群"]),
      資料夾: body?.資料夾,
      經紀人: body?.經紀人,
      KOL開發者: body?.KOL開發者,
      合約開始日期: body?.合約開始日期,
      廣告經銷夥伴: Boolean(body?.廣告經銷夥伴),
      節目製作夥伴: Boolean(body?.節目製作夥伴),
      課程製作夥伴: Boolean(body?.課程製作夥伴),
      Email: body?.Email,
      分級: body?.分級,
    });

    return NextResponse.json({ ok: true, partner });
  } catch (error) {
    console.error("POST /api/partners error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "新增失敗" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await request.json()) as { PartnerID?: string } & Partial<UpdatePartnerInput> | null;
    const PartnerID = String(body?.PartnerID ?? "").trim();
    if (!PartnerID) {
      return NextResponse.json({ ok: false, error: "PartnerID 為必填" }, { status: 400 });
    }

    const rest = { ...(body ?? {}) } as Record<string, unknown>;
    delete rest.PartnerID;
    const partner = await updatePartner(PartnerID, rest as UpdatePartnerInput);
    if (!partner) {
      return NextResponse.json({ ok: false, error: "更新失敗或找不到該合作夥伴" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, partner });
  } catch (error) {
    console.error("PATCH /api/partners error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "更新失敗" },
      { status: 500 }
    );
  }
}
