import { NextRequest, NextResponse } from "next/server";
import {
  getPartnersApprovedWithError,
  getPartnersPendingWithError,
  createPartner,
  updatePartner,
  type NewPartnerInput,
  type UpdatePartnerInput,
} from "@/lib/db/partners";
import { requireAdmin, requireAuth, ADMIN_ROLES } from "@/lib/auth/api";
import { PARTNER_STATUS, PARTNER_AGENT_EDITABLE_KEYS, PARTNER_AGENT_PENDING_EDITABLE_KEYS } from "@/lib/db/partner-approval";
import { getPartnersWithError } from "@/lib/db/partners";

function isAdminRole(role: string): boolean {
  return ADMIN_ROLES.includes(role as (typeof ADMIN_ROLES)[number]);
}

/** 經紀人 PATCH 時只允許這些 key（已核准） */
const AGENT_APPROVED_KEYS = new Set(PARTNER_AGENT_EDITABLE_KEYS as unknown as string[]);
/** 待審核／已駁回且為建立者時允許的 key */
const AGENT_PENDING_KEYS = new Set(PARTNER_AGENT_PENDING_EDITABLE_KEYS as unknown as string[]);

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const { searchParams } = new URL(request.url);
    const pending = searchParams.get("pending") === "1" || searchParams.get("status") === "pending";

    if (pending) {
      const { partners, error } = await getPartnersPendingWithError(auth.user.email, isAdminRole(auth.user.role));
      return NextResponse.json({
        ok: true,
        partners,
        pending: true,
        ...(error ? { partnersError: error } : {}),
      });
    }

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

    const admin = isAdminRole(auth.user.role);
    const 審核狀態 = admin ? PARTNER_STATUS.APPROVED : PARTNER_STATUS.PENDING;
    const 建立者 = admin ? null : auth.user.email;

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
        經紀人: body?.經紀人 ?? auth.user.name ?? auth.user.email,
        KOL開發者: body?.KOL開發者,
        合約開始日期: body?.合約開始日期,
        廣告經銷夥伴: Boolean(body?.廣告經銷夥伴),
        節目製作夥伴: Boolean(body?.節目製作夥伴),
        課程製作夥伴: Boolean(body?.課程製作夥伴),
        Email: body?.Email,
        分級: body?.分級,
      },
      { 審核狀態, 建立者 }
    );

    return NextResponse.json({
      ok: true,
      partner,
      pending: !admin,
      message: admin ? undefined : "已送出待審核，董事長核准後會出現在主列表",
    });
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

    const admin = isAdminRole(auth.user.role);
    const rest = { ...(body ?? {}) } as Record<string, unknown>;
    delete rest.PartnerID;

    if (admin) {
      const partner = await updatePartner(PartnerID, rest as UpdatePartnerInput);
      if (!partner) {
        return NextResponse.json({ ok: false, error: "更新失敗或找不到該合作夥伴" }, { status: 404 });
      }
      return NextResponse.json({ ok: true, partner });
    }

    // 經紀人：需先取得該筆判斷狀態與建立者
    const { partners } = await getPartnersWithError();
    const row = partners.find((p) => p.PartnerID === PartnerID);
    if (!row) {
      return NextResponse.json({ ok: false, error: "找不到該合作夥伴" }, { status: 404 });
    }
    const status = row.審核狀態 ?? PARTNER_STATUS.APPROVED;
    const creator = String(row.建立者 ?? "").trim().toLowerCase();
    const me = auth.user.email.trim().toLowerCase();
    const isCreator = creator === me;
    const agentMatch =
      String(row.經紀人 ?? "").trim().toLowerCase() === me ||
      String(row.經紀人 ?? "").trim() === auth.user.name;

    if (status === PARTNER_STATUS.APPROVED) {
      if (!agentMatch && !isCreator) {
        return NextResponse.json({ ok: false, error: "僅負責經紀人或建立者可修改部分欄位" }, { status: 403 });
      }
      const filtered: UpdatePartnerInput = {};
      for (const k of AGENT_APPROVED_KEYS) {
        if (rest[k] !== undefined) (filtered as Record<string, unknown>)[k] = rest[k];
      }
      if (Object.keys(filtered).length === 0) {
        return NextResponse.json({ ok: false, error: "無可更新的欄位（經紀人僅能改社群網站、粉絲數等）" }, { status: 400 });
      }
      const partner = await updatePartner(PartnerID, filtered);
      if (!partner) return NextResponse.json({ ok: false, error: "更新失敗" }, { status: 404 });
      return NextResponse.json({ ok: true, partner });
    }

    // 待審核 / 已駁回：僅建立者可改，且核准後需董事長操作
    if (!isCreator) {
      return NextResponse.json({ ok: false, error: "僅建立者可修改待審核申請" }, { status: 403 });
    }
    const filtered: UpdatePartnerInput = {};
    for (const k of AGENT_PENDING_KEYS) {
      if (rest[k] !== undefined) (filtered as Record<string, unknown>)[k] = rest[k];
    }
    // 駁回後再編輯：清駁回理由並改回待審核
    if (status === PARTNER_STATUS.REJECTED) {
      filtered.審核狀態 = PARTNER_STATUS.PENDING;
      filtered.駁回理由 = null;
    }
    if (Object.keys(filtered).length === 0) {
      return NextResponse.json({ ok: false, error: "無可更新的欄位" }, { status: 400 });
    }
    const partner = await updatePartner(PartnerID, filtered);
    if (!partner) return NextResponse.json({ ok: false, error: "更新失敗" }, { status: 404 });
    return NextResponse.json({ ok: true, partner });
  } catch (error) {
    console.error("PATCH /api/partners error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "更新失敗" },
      { status: 500 }
    );
  }
}
