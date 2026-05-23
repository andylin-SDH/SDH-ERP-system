import { NextRequest, NextResponse } from "next/server";
import {
  getPartnersApprovedWithError,
  createPartner,
  updatePartnerWithEditLog,
  findPartnerDuplicate,
  formatPartnerDuplicateError,
  deletePartner,
  getPartnerById,
  type NewPartnerInput,
  type UpdatePartnerInput,
} from "@/lib/db/partners";
import { requireAdmin, requireAuth, ADMIN_ROLES } from "@/lib/auth/api";
import { isPartnerAgentBlockedKey } from "@/lib/db/partner-approval";
import { partnerEditorLabel } from "@/lib/partners/editor-label";
import { deletePartnerAvatarObject } from "@/lib/partners/avatar-storage";

function isAdminRole(role: string): boolean {
  return ADMIN_ROLES.includes(role as (typeof ADMIN_ROLES)[number]);
}

function filterAgentPatchPayload(rest: Record<string, unknown>): UpdatePartnerInput {
  const filtered: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) {
    if (isPartnerAgentBlockedKey(k)) continue;
    filtered[k] = v;
  }
  return filtered as UpdatePartnerInput;
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const { partners, error: partnersError, usedFallback } = await getPartnersApprovedWithError();
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
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await request.json()) as Partial<NewPartnerInput> | null;
    const PartnerID = String(body?.PartnerID ?? "").trim();
    if (!PartnerID) {
      return NextResponse.json({ ok: false, error: "PartnerID 為必填" }, { status: 400 });
    }
    const name = String(body?.合作夥伴名稱 ?? "").trim();
    if (!name) {
      return NextResponse.json({ ok: false, error: "合作夥伴名稱 為必填" }, { status: 400 });
    }

    const dup = await findPartnerDuplicate({
      合作夥伴名稱: name,
      Email: body?.Email,
      excludePartnerId: PartnerID,
    });
    if (dup) {
      return NextResponse.json(
        { ok: false, error: formatPartnerDuplicateError(dup) },
        { status: 409 }
      );
    }

    const admin = isAdminRole(auth.user.role);
    const editor = partnerEditorLabel(auth.user);

    const partner = await createPartner(
      {
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
        KOL開發者: admin ? body?.KOL開發者 : undefined,
        經銷約開始日: body?.經銷約開始日,
        自來件分潤: body?.自來件分潤,
        "SDH開發分件分潤": body?.["SDH開發分件分潤"],
        經銷約結束日: body?.經銷約結束日,
        廣告經銷夥伴: Boolean(body?.廣告經銷夥伴),
        節目製作夥伴: Boolean(body?.節目製作夥伴),
        課程製作夥伴: Boolean(body?.課程製作夥伴),
        Email: body?.Email,
        分級: body?.分級,
      },
      { 建立者: editor }
    );

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
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await request.json()) as { PartnerID?: string } & Partial<UpdatePartnerInput> | null;
    const PartnerID = String(body?.PartnerID ?? "").trim();
    if (!PartnerID) {
      return NextResponse.json({ ok: false, error: "PartnerID 為必填" }, { status: 400 });
    }

    const row = await getPartnerById(PartnerID);
    if (!row) {
      return NextResponse.json({ ok: false, error: "找不到該合作夥伴" }, { status: 404 });
    }

    const admin = isAdminRole(auth.user.role);
    const editor = partnerEditorLabel(auth.user);
    const rest = { ...(body ?? {}) } as Record<string, unknown>;
    delete rest.PartnerID;

    const filtered = admin ? (rest as UpdatePartnerInput) : filterAgentPatchPayload(rest);
    if (Object.keys(filtered).length === 0) {
      return NextResponse.json(
        { ok: false, error: admin ? "無可更新的欄位" : "無可更新的欄位（KOL開發者僅董事長／管理者可改）" },
        { status: 400 }
      );
    }

    const { partner, noChanges } = await updatePartnerWithEditLog(PartnerID, row, filtered, editor);
    if (!partner) {
      return NextResponse.json({ ok: false, error: "更新失敗" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, partner, noChanges: Boolean(noChanges) });
  } catch (error) {
    console.error("PATCH /api/partners error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "更新失敗" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const { searchParams } = new URL(request.url);
    const PartnerID = String(searchParams.get("PartnerID") ?? "").trim();
    if (!PartnerID) {
      return NextResponse.json({ ok: false, error: "PartnerID 為必填" }, { status: 400 });
    }
    const ok = await deletePartner(PartnerID);
    if (!ok) {
      return NextResponse.json({ ok: false, error: "刪除失敗或找不到該合作夥伴" }, { status: 404 });
    }
    try {
      await deletePartnerAvatarObject(PartnerID);
    } catch {
      /* 無形象照時忽略 */
    }
    return NextResponse.json({ ok: true, PartnerID });
  } catch (error) {
    console.error("DELETE /api/partners error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "刪除失敗" },
      { status: 500 }
    );
  }
}
