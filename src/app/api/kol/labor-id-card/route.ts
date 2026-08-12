/**
 * POST：KOL 上傳勞報身分證正／反面（寫入 partners，下次自動帶出）
 * DELETE：移除單面影本
 */

import { NextRequest, NextResponse } from "next/server";
import { requireKol } from "@/lib/auth/api";
import { resolveKolPartnerForUser } from "@/lib/kol/partner-bind";
import {
  savePartnerLaborProfile,
  getPartnerLaborProfile,
} from "@/lib/kol/partner-labor-profile";
import {
  uploadLaborIdCard,
  validateLaborIdCardFile,
  type LaborIdCardSide,
} from "@/lib/kol/labor-id-card-storage";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await requireKol(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const partner = await resolveKolPartnerForUser(auth.user);
    if (!partner.ok) {
      return NextResponse.json({ ok: false, error: partner.error }, { status: 403 });
    }

    const formData = await request.formData();
    const sideRaw = String(formData.get("side") ?? "").trim();
    const side: LaborIdCardSide | null = sideRaw === "front" || sideRaw === "back" ? sideRaw : null;
    const file = formData.get("file");
    if (!side) {
      return NextResponse.json({ ok: false, error: "side 須為 front 或 back" }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "請選擇圖片檔案" }, { status: 400 });
    }
    const validationError = validateLaborIdCardFile(file);
    if (validationError) {
      return NextResponse.json({ ok: false, error: validationError }, { status: 400 });
    }

    const url = await uploadLaborIdCard(
      partner.binding.partnerId,
      side,
      file,
      file.type || "image/jpeg"
    );
    await savePartnerLaborProfile(partner.binding.partnerId, {
      ...(side === "front" ? { 身分證正面: url } : { 身分證反面: url }),
    });

    const profile = await getPartnerLaborProfile(partner.binding.partnerId);
    return NextResponse.json({
      ok: true,
      side,
      url,
      laborProfile: profile,
    });
  } catch (e) {
    console.error("POST /api/kol/labor-id-card", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "上傳失敗" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireKol(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const partner = await resolveKolPartnerForUser(auth.user);
    if (!partner.ok) {
      return NextResponse.json({ ok: false, error: partner.error }, { status: 403 });
    }
    const sideRaw = String(new URL(request.url).searchParams.get("side") ?? "").trim();
    if (sideRaw !== "front" && sideRaw !== "back") {
      return NextResponse.json({ ok: false, error: "side 須為 front 或 back" }, { status: 400 });
    }
    await savePartnerLaborProfile(partner.binding.partnerId, {
      ...(sideRaw === "front" ? { 身分證正面: "" } : { 身分證反面: "" }),
    });
    const profile = await getPartnerLaborProfile(partner.binding.partnerId);
    return NextResponse.json({ ok: true, laborProfile: profile });
  } catch (e) {
    console.error("DELETE /api/kol/labor-id-card", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "刪除失敗" },
      { status: 500 }
    );
  }
}
