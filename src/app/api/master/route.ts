/**
 * 大總表 API
 * GET：回傳所有大總表資料（需登入）
 * POST：新增一筆大總表（需登入，任何人可建立專案）
 * PATCH：更新大總表（登入即可；金額全開並寫入修改紀錄；分潤成數僅 master.update 角色可改）
 * DELETE：刪除專案（僅董事長；連動任務、分潤表、財務）
 */

import { NextRequest, NextResponse } from "next/server";
import {
  applyMasterNumericFieldPolicy,
  canEditMasterNumericFields,
} from "@/config/master-permissions";
import {
  createMaster,
  getMasterById,
  getMasterList,
  masterDbErrorMessage,
  todayYmdTaipei,
  updateMaster,
  type NewMasterInput,
  type UpdateMasterInput,
} from "@/lib/db/master";
import {
  buildMasterChangeDiff,
  insertMasterEditLog,
  MASTER_EDIT_ACTION,
  masterCreateSnapshot,
  updateMasterPayloadToRecord,
} from "@/lib/db/master-edit-log";
import { softDeleteMasterProjectByRowId } from "@/lib/db/master-project-delete";
import { getSystemConfig } from "@/lib/db/system-config";
import { syncPayoutForProject } from "@/lib/db/payout";
import { syncFinanceForProject } from "@/lib/db/finance";
import { requireEmployee } from "@/lib/auth/api";
import { getUserByEmail, getUsers } from "@/lib/db/users";
import { partnerEditorLabel } from "@/lib/partners/editor-label";
import { findSimilarProjectNames } from "@/lib/master/similar-name";
import { TWO_ROLE_PAYOUT_SCHEME, isCompanySupervisor, isTwoRolePayoutProject, projectSupervisorForOpener } from "@/config/master-payout-defaults";

export async function GET(request: NextRequest) {
  const auth = await requireEmployee(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const list = await getMasterList();
    return NextResponse.json({ ok: true, list });
  } catch (error) {
    console.error("GET /api/master error:", error);
    return NextResponse.json(
      { ok: false, error: masterDbErrorMessage(error, "讀取大總表失敗") },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireEmployee(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await request.json()) as Partial<NewMasterInput> | null;
    const 專案ID = String(body?.專案ID ?? "").trim();
    if (!專案ID) {
      return NextResponse.json({ ok: false, error: "專案ID 為必填" }, { status: 400 });
    }
    const { master_payout_defaults, role_permissions } = await getSystemConfig();
    const role = auth.user.role;
    const canCreate = role_permissions.master.create.includes(role);
    if (!canCreate) {
      return NextResponse.json({ ok: false, error: "您沒有建立專案的權限" }, { status: 403 });
    }

    const confirmSimilarName = Boolean((body as { confirmSimilarName?: boolean } | null)?.confirmSimilarName);
    if (!confirmSimilarName) {
      const existing = await getMasterList();
      const matches = findSimilarProjectNames(existing, {
        專案名稱: (body?.專案名稱 as string) ?? "",
        KOL名稱: (body?.KOL名稱 as string) ?? "",
      });
      if (matches.length > 0) {
        return NextResponse.json(
          {
            ok: false,
            code: "similar_project",
            error: "已有名稱很接近的專案。同一位老師多一筆會多一筆待請款，而且對不上發票。若確定是不同專案，請勾選後再建立。",
            matches,
          },
          { status: 409 }
        );
      }
    }

    const today = todayYmdTaipei();
    const payload: NewMasterInput = {
      專案ID,
      專案名稱: (body?.專案名稱 as string) ?? null,
      專案類型: (body?.專案類型 as string) ?? null,
      專案狀態: String(body?.專案狀態 ?? "").trim() || "進行中",
      長期案: Boolean(body?.長期案),
      母專案ID: (body?.母專案ID as string) ?? null,
      合約連結: (body?.合約連結 as string) ?? null,
      狀態確認日期: today,
      開案日期: (body?.開案日期 as string) ?? null,
      專案總金額未稅: (body?.專案總金額未稅 as string) ?? null,
      專案營收: (body?.專案營收 as string) ?? null,
      專案成本: (body?.專案成本 as string) ?? null,
      KOL費用未稅: (body?.KOL費用未稅 as string) ?? null,
      KOL應收額外成本: (body?.KOL應收額外成本 as string) ?? null,
      KOL名稱: (body?.KOL名稱 as string) ?? null,
      經紀人: (body?.經紀人 as string) ?? null,
      主管: (body?.主管 as string) ?? null,
      KOL開發者: (body?.KOL開發者 as string) ?? null,
      專案費用類型: (body?.專案費用類型 as string) ?? null,
      廠商名稱: (body?.廠商名稱 as string) ?? null,
      統一編號: (body?.統一編號 as string) ?? null,
      收件人Email: (body?.收件人Email as string) ?? null,
      廠商預計付款日: (body?.廠商預計付款日 as string) ?? null,
      專案內容: (body?.專案內容 as string) ?? null,
      備註: (body?.備註 as string) ?? null,
      老師備註: (body?.老師備註 as string) ?? null,
      專案BDPM: null,
      專案BDPM分潤成數: null,
      專案引薦人: null,
      專案開發人: null,
      專案管理員: null,
      執行管理員: (body?.執行管理員 as string) ?? null,
      專案資料夾: (body?.專案資料夾 as string) ?? null,
      專案引薦人分潤成數: null,
      專案開發人分潤成數: null,
      專案管理員分潤成數: null,
      執行管理員分潤成數: (body?.執行管理員分潤成數 as string) ?? master_payout_defaults.執行管理員分潤成數,
      直屬主管: null,
      直屬主管分潤成數: null,
      分潤制度: TWO_ROLE_PAYOUT_SCHEME,
    };
    const creator = await getUserByEmail(auth.user.email);
    const pmName = String(creator?.name || auth.user.name || auth.user.email).trim();
    const staff = await getUsers();
    const boss = projectSupervisorForOpener(
      pmName,
      creator?.直屬主管,
      isCompanySupervisor(
        pmName,
        staff.map((user) => user.直屬主管 ?? "")
      )
    );
    payload.經紀人 = null;
    payload.主管 = null;
    payload.KOL開發者 = null;
    payload.執行管理員 = pmName || null;
    payload.執行管理員分潤成數 = "7.5%";
    payload.直屬主管 = boss || null;
    payload.直屬主管分潤成數 = boss ? "2.5%" : null;
    payload.分潤制度 = TWO_ROLE_PAYOUT_SCHEME;

    const master = await createMaster(payload);
    const editor = partnerEditorLabel(auth.user);
    await insertMasterEditLog({
      專案ID: master.專案ID,
      操作: MASTER_EDIT_ACTION.CREATE,
      更新者: editor,
      變更內容: masterCreateSnapshot(payload),
    });
    try {
      const masterForPayout = { ...master, 分潤制度: TWO_ROLE_PAYOUT_SCHEME };
      await syncPayoutForProject(masterForPayout, master_payout_defaults);
      await syncFinanceForProject(master);
    } catch (e) {
      console.error("syncPayoutForProject after POST /api/master", e);
    }
    return NextResponse.json({ ok: true, master });
  } catch (error) {
    console.error("POST /api/master error:", error);
    return NextResponse.json(
      { ok: false, error: masterDbErrorMessage(error, "新增大總表失敗") },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireEmployee(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await request.json()) as Partial<UpdateMasterInput> | null;
    const id = String(body?.id ?? "").trim();
    if (!id) {
      return NextResponse.json({ ok: false, error: "id 為必填" }, { status: 400 });
    }
    const { role_permissions } = await getSystemConfig();
    const role = auth.user.role;
    const canEditRates = canEditMasterNumericFields(role, role_permissions);

    const existing = await getMasterById(id);
    if (!existing) {
      return NextResponse.json({ ok: false, error: "找不到該專案" }, { status: 404 });
    }

    const confirmSimilarName = Boolean((body as { confirmSimilarName?: boolean } | null)?.confirmSimilarName);
    const nextName = (body?.專案名稱 as string) ?? existing.專案名稱 ?? "";
    const nextKol = (body?.KOL名稱 as string) ?? existing.KOL名稱 ?? "";
    const nameChanged = String(nextName ?? "").trim() !== String(existing.專案名稱 ?? "").trim();
    const kolChanged = String(nextKol ?? "").trim() !== String(existing.KOL名稱 ?? "").trim();
    if (!confirmSimilarName && (nameChanged || kolChanged)) {
      const list = await getMasterList();
      const matches = findSimilarProjectNames(list, {
        專案名稱: nextName,
        KOL名稱: nextKol,
        excludeId: existing.專案ID,
      });
      if (matches.length > 0) {
        return NextResponse.json(
          {
            ok: false,
            code: "similar_project",
            error: "已有名稱很接近的專案。同一位老師多一筆會多一筆待請款，而且對不上發票。若確定是不同專案，請勾選後再儲存。",
            matches,
          },
          { status: 409 }
        );
      }
    }

    const today = todayYmdTaipei();
    const rawPayload: UpdateMasterInput = {
      id,
      專案名稱: (body?.專案名稱 as string) ?? null,
      專案類型: (body?.專案類型 as string) ?? null,
      專案狀態: (body?.專案狀態 as string) ?? null,
      長期案: Boolean(body?.長期案),
      // 僅在有傳入時帶入，讓 updateMaster 的守衞式判斷可略過未變動欄位
      ...(body?.母專案ID !== undefined ? { 母專案ID: (body.母專案ID as string) ?? null } : {}),
      ...(body?.合約連結 !== undefined ? { 合約連結: (body.合約連結 as string) ?? null } : {}),
      狀態確認日期: today,
      開案日期: (body?.開案日期 as string) ?? null,
      專案總金額未稅: (body?.專案總金額未稅 as string) ?? null,
      專案營收: (body?.專案營收 as string) ?? null,
      專案成本: (body?.專案成本 as string) ?? null,
      KOL費用未稅: (body?.KOL費用未稅 as string) ?? null,
      KOL應收額外成本: (body?.KOL應收額外成本 as string) ?? null,
      KOL名稱: (body?.KOL名稱 as string) ?? null,
      經紀人: (body?.經紀人 as string) ?? null,
      主管: (body?.主管 as string) ?? null,
      KOL開發者: (body?.KOL開發者 as string) ?? null,
      專案費用類型: (body?.專案費用類型 as string) ?? null,
      廠商名稱: (body?.廠商名稱 as string) ?? null,
      統一編號:
        body && Object.prototype.hasOwnProperty.call(body, "統一編號")
          ? ((body.統一編號 as string) ?? null)
          : (existing.統一編號 ?? null),
      收件人Email:
        body && Object.prototype.hasOwnProperty.call(body, "收件人Email")
          ? ((body.收件人Email as string) ?? null)
          : (existing.收件人Email ?? null),
      廠商預計付款日: (body?.廠商預計付款日 as string) ?? null,
      專案內容: (body?.專案內容 as string) ?? null,
      備註: (body?.備註 as string) ?? null,
      /** 沒帶這個欄位的舊請求，沿用資料庫原值，避免被清空 */
      老師備註:
        body && Object.prototype.hasOwnProperty.call(body, "老師備註")
          ? ((body.老師備註 as string) ?? null)
          : (existing.老師備註 ?? null),
      專案BDPM: (body?.專案BDPM as string) ?? null,
      專案引薦人: (body?.專案引薦人 as string) ?? null,
      專案開發人: (body?.專案開發人 as string) ?? null,
      專案管理員: (body?.專案管理員 as string) ?? null,
      執行管理員: (body?.執行管理員 as string) ?? null,
      專案資料夾: (body?.專案資料夾 as string) ?? null,
      直屬主管:
        body && Object.prototype.hasOwnProperty.call(body, "直屬主管")
          ? ((body.直屬主管 as string) ?? null)
          : (existing.直屬主管 ?? null),
      直屬主管分潤成數:
        body && Object.prototype.hasOwnProperty.call(body, "直屬主管分潤成數")
          ? ((body.直屬主管分潤成數 as string) ?? null)
          : (existing.直屬主管分潤成數 ?? null),
    };

    if (isTwoRolePayoutProject(existing)) {
      rawPayload.分潤制度 = TWO_ROLE_PAYOUT_SCHEME;
      rawPayload.專案BDPM = null;
      rawPayload.專案引薦人 = null;
      rawPayload.專案開發人 = null;
      rawPayload.專案管理員 = null;
      rawPayload.經紀人 = null;
      rawPayload.主管 = null;
      rawPayload.KOL開發者 = null;
      rawPayload.專案BDPM分潤成數 = null;
      rawPayload.專案引薦人分潤成數 = null;
      rawPayload.專案開發人分潤成數 = null;
      rawPayload.專案管理員分潤成數 = null;
    }

    const payload = applyMasterNumericFieldPolicy(
      rawPayload as unknown as Record<string, unknown>,
      existing as unknown as Record<string, unknown>,
      canEditRates
    ) as UpdateMasterInput;

    const diff = buildMasterChangeDiff(existing, updateMasterPayloadToRecord(payload));
    const master = await updateMaster(payload);
    if (diff) {
      await insertMasterEditLog({
        專案ID: master.專案ID || existing.專案ID,
        操作: MASTER_EDIT_ACTION.UPDATE,
        更新者: partnerEditorLabel(auth.user),
        變更內容: diff.變更內容,
        變更前快照: diff.變更前快照,
      });
    }
    if (master) {
      const { master_payout_defaults } = await getSystemConfig();
      try {
        await syncPayoutForProject(master, master_payout_defaults);
        await syncFinanceForProject(master);
      } catch (e) {
        console.error("syncPayoutForProject after PATCH /api/master", e);
      }
    }
    return NextResponse.json({ ok: true, master });
  } catch (error) {
    console.error("PATCH /api/master error:", error);
    return NextResponse.json(
      { ok: false, error: masterDbErrorMessage(error, "更新大總表失敗") },
      { status: 500 }
    );
  }
}

/** 軟刪專案（僅董事長）；保留任務／分潤／財務與編輯紀錄，可還原 */
export async function DELETE(request: NextRequest) {
  const auth = await requireEmployee(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.user.role !== "董事長") {
    return NextResponse.json({ ok: false, error: "僅董事長可刪除專案" }, { status: 403 });
  }
  try {
    const body = (await request.json().catch(() => ({}))) as { id?: string; reason?: string } | null;
    const id = String(body?.id ?? "").trim();
    if (!id) {
      return NextResponse.json({ ok: false, error: "id 為必填" }, { status: 400 });
    }
    const editor = partnerEditorLabel(auth.user);
    const result = await softDeleteMasterProjectByRowId(id, editor, body?.reason);
    return NextResponse.json({ ok: true, softDeleted: true, ...result });
  } catch (error) {
    console.error("DELETE /api/master error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "刪除失敗" },
      { status: 500 }
    );
  }
}
