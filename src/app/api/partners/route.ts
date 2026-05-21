import { NextRequest, NextResponse } from "next/server";
import {
  getPartnersApprovedWithError,
  getPartnersPendingWithError,
  createPartner,
  updatePartner,
  findPartnerDuplicate,
  formatPartnerDuplicateError,
  type NewPartnerInput,
  type UpdatePartnerInput,
} from "@/lib/db/partners";
import { requireAdmin, requireAuth, ADMIN_ROLES } from "@/lib/auth/api";
import { PARTNER_STATUS, isPartnerAgentBlockedKey } from "@/lib/db/partner-approval";
import { getPartnersWithError } from "@/lib/db/partners";
import {
  upsertPendingChangeRequest,
  buildSnapshotForKeys,
  listChangeRequestsPending,
} from "@/lib/db/partner-change-requests";

function isAdminRole(role: string): boolean {
  return ADMIN_ROLES.includes(role as (typeof ADMIN_ROLES)[number]);
}

/** 非管理者 PATCH：允許除 KOL開發者／審核狀態／駁回理由 外的所有 UpdatePartnerInput 欄位 */
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
    const { searchParams } = new URL(request.url);
    const pending = searchParams.get("pending") === "1" || searchParams.get("status") === "pending";

    if (pending) {
      const { partners, error } = await getPartnersPendingWithError(auth.user.email, isAdminRole(auth.user.role));
      let changeRequests: Awaited<ReturnType<typeof listChangeRequestsPending>> = [];
      try {
        changeRequests = await listChangeRequestsPending(auth.user.email, isAdminRole(auth.user.role));
      } catch {
        /* 表尚未建立 */
      }
      return NextResponse.json({
        ok: true,
        partners,
        changeRequests,
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
        /** 非管理者不可指定 KOL開發者，由董事長後續補 */
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

    // 非管理者：需先取得該筆判斷狀態與建立者
    const { partners } = await getPartnersWithError();
    const row = partners.find((p) => p.PartnerID === PartnerID);
    if (!row) {
      return NextResponse.json({ ok: false, error: "找不到該合作夥伴" }, { status: 404 });
    }
    const status = row.審核狀態 ?? PARTNER_STATUS.APPROVED;
    const creator = String(row.建立者 ?? "").trim().toLowerCase();
    const me = auth.user.email.trim().toLowerCase();
    const isCreator = creator === me;
    if (status === PARTNER_STATUS.APPROVED) {
      /**
       * 非管理者編輯已核准 KOL：不從主列表消失，改寫入 partner_change_requests；
       * 董事長核准後才合併回 partners；駁回則留在待審核顯示未通過
       */
      const filtered = filterAgentPatchPayload(rest);
      if (Object.keys(filtered).length === 0) {
        return NextResponse.json({ ok: false, error: "無可更新的欄位（KOL開發者僅董事長可改）" }, { status: 400 });
      }
      const keys = Object.keys(filtered);
      const 變更前快照 = buildSnapshotForKeys(row, keys);
      const { row: req, error: reqErr } = await upsertPendingChangeRequest(
        PartnerID,
        filtered as Record<string, unknown>,
        auth.user.email,
        變更前快照
      );
      if (!req) {
        return NextResponse.json(
          {
            ok: false,
            error:
              reqErr ??
              "變更申請寫入失敗，請確認已執行 migration 024，並檢查 RLS 是否允許 insert。",
          },
          { status: 500 }
        );
      }
      return NextResponse.json({
        ok: true,
        partner: row,
        changeRequest: req,
        reAudit: true,
        message: "已送出變更審核，主列表資料不變；董事長核准後才會更新",
      });
    }

    // 待審核 / 已駁回：僅建立者可改，且核准後需董事長操作
    if (!isCreator) {
      return NextResponse.json({ ok: false, error: "僅建立者可修改待審核申請" }, { status: 403 });
    }
    const filtered = filterAgentPatchPayload(rest);
    // 駁回後再編輯：清駁回理由並改回待審核（管理者專用欄位，僅在此流程寫入）
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
