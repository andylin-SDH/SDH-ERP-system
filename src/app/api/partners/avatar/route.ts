import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/api";
import { updatePartner } from "@/lib/db/partners";
import {
  deletePartnerAvatarObject,
  uploadPartnerAvatar,
  validatePartnerAvatarFile,
} from "@/lib/partners/avatar-storage";

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const formData = await request.formData();
    const PartnerID = String(formData.get("PartnerID") ?? "").trim();
    const file = formData.get("file");
    if (!PartnerID) {
      return NextResponse.json({ ok: false, error: "PartnerID 為必填" }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "請選擇圖片檔案" }, { status: 400 });
    }
    const validationError = validatePartnerAvatarFile(file);
    if (validationError) {
      return NextResponse.json({ ok: false, error: validationError }, { status: 400 });
    }

    const url = await uploadPartnerAvatar(PartnerID, file, file.type || "image/jpeg");
    const partner = await updatePartner(PartnerID, { 形象照: url });
    if (!partner) {
      return NextResponse.json({ ok: false, error: "更新合作夥伴失敗（請確認已執行 migration 050）" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, partner, avatarUrl: url });
  } catch (error) {
    console.error("POST /api/partners/avatar error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "上傳失敗" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const { searchParams } = new URL(request.url);
    const PartnerID = String(searchParams.get("PartnerID") ?? "").trim();
    if (!PartnerID) {
      return NextResponse.json({ ok: false, error: "PartnerID 為必填" }, { status: 400 });
    }
    await deletePartnerAvatarObject(PartnerID);
    const partner = await updatePartner(PartnerID, { 形象照: null });
    if (!partner) {
      return NextResponse.json({ ok: false, error: "更新合作夥伴失敗" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, partner });
  } catch (error) {
    console.error("DELETE /api/partners/avatar error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "刪除失敗" },
      { status: 500 }
    );
  }
}
