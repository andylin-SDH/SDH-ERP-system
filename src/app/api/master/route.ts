/**
 * 大總表 API
 * GET：回傳所有大總表資料（需登入）
 * POST：新增一筆大總表（需登入，任何人可建立專案）
 * PATCH：更新大總表（限董事長/管理者）
 * DELETE：刪除專案（僅董事長；連動任務、分潤表、財務）
 */

import { NextRequest, NextResponse } from "next/server";
import { createMaster, getMasterList, updateMaster, type NewMasterInput, type UpdateMasterInput } from "@/lib/db/master";
import { deleteMasterProjectByRowId } from "@/lib/db/master-project-delete";
import { DEFAULT_PAYOUT_DEDUPE_RULES } from "@/config/payout-dedupe-defaults";
import { getSystemConfig } from "@/lib/db/system-config";
import { syncPayoutForProject } from "@/lib/db/payout";
import { syncFinanceForProject } from "@/lib/db/finance";
import { requireAdmin, requireAuth } from "@/lib/auth/api";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const list = await getMasterList();
    return NextResponse.json({ ok: true, list });
  } catch (error) {
    console.error("GET /api/master error:", error);
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
    const body = (await request.json()) as Partial<NewMasterInput> | null;
    const 專案ID = String(body?.專案ID ?? "").trim();
    if (!專案ID) {
      return NextResponse.json({ ok: false, error: "專案ID 為必填" }, { status: 400 });
    }
    const { master_payout_defaults, role_permissions, payout_dedupe_rules } = await getSystemConfig();
    const role = auth.user.role;
    const canCreate = role_permissions.master.create.includes(role);
    if (!canCreate) {
      return NextResponse.json({ ok: false, error: "您沒有建立專案的權限" }, { status: 403 });
    }

    const payload: NewMasterInput = {
      專案ID,
      專案名稱: (body?.專案名稱 as string) ?? null,
      專案類型: (body?.專案類型 as string) ?? null,
      專案狀態: (body?.專案狀態 as string) ?? null,
      狀態確認日期: (body?.狀態確認日期 as string) ?? null,
      開案日期: (body?.開案日期 as string) ?? null,
      專案總金額未稅: (body?.專案總金額未稅 as string) ?? null,
      專案營收: (body?.專案營收 as string) ?? null,
      專案成本: (body?.專案成本 as string) ?? null,
      KOL費用未稅: (body?.KOL費用未稅 as string) ?? null,
      KOL名稱: (body?.KOL名稱 as string) ?? null,
      經紀人: (body?.經紀人 as string) ?? null,
      專案費用類型: (body?.專案費用類型 as string) ?? null,
      廠商名稱: (body?.廠商名稱 as string) ?? null,
      廠商預計付款日: (body?.廠商預計付款日 as string) ?? null,
      專案內容: (body?.專案內容 as string) ?? null,
      備註: (body?.備註 as string) ?? null,
      專案BDPM: (body?.專案BDPM as string) ?? null,
      專案BDPM分潤成數: (body?.專案BDPM分潤成數 as string) ?? master_payout_defaults.專案BDPM分潤成數,
      專案引薦人: (body?.專案引薦人 as string) ?? null,
      專案開發人: (body?.專案開發人 as string) ?? null,
      專案管理員: (body?.專案管理員 as string) ?? null,
      執行管理員: (body?.執行管理員 as string) ?? null,
      專案資料夾: (body?.專案資料夾 as string) ?? null,
      專案引薦人分潤成數: (body?.專案引薦人分潤成數 as string) ?? master_payout_defaults.專案引薦人分潤成數,
      專案開發人分潤成數: (body?.專案開發人分潤成數 as string) ?? master_payout_defaults.專案開發人分潤成數,
      專案管理員分潤成數: (body?.專案管理員分潤成數 as string) ?? master_payout_defaults.專案管理員分潤成數,
      執行管理員分潤成數: (body?.執行管理員分潤成數 as string) ?? master_payout_defaults.執行管理員分潤成數,
    };

    const master = await createMaster(payload);
    try {
      await syncPayoutForProject(master, master_payout_defaults, payout_dedupe_rules ?? DEFAULT_PAYOUT_DEDUPE_RULES);
      await syncFinanceForProject(master);
    } catch (e) {
      console.error("syncPayoutForProject after POST /api/master", e);
    }
    return NextResponse.json({ ok: true, master });
  } catch (error) {
    console.error("POST /api/master error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await request.json()) as Partial<UpdateMasterInput> | null;
    const id = String(body?.id ?? "").trim();
    if (!id) {
      return NextResponse.json({ ok: false, error: "id 為必填" }, { status: 400 });
    }
    const { role_permissions } = await getSystemConfig();
    const role = auth.user.role;
    const canUpdate = role_permissions.master.update.includes(role);
    if (!canUpdate) {
      return NextResponse.json({ ok: false, error: "您沒有編輯專案的權限" }, { status: 403 });
    }
    const payload: UpdateMasterInput = {
      id,
      專案名稱: (body?.專案名稱 as string) ?? null,
      專案類型: (body?.專案類型 as string) ?? null,
      專案狀態: (body?.專案狀態 as string) ?? null,
      狀態確認日期: (body?.狀態確認日期 as string) ?? null,
      開案日期: (body?.開案日期 as string) ?? null,
      專案總金額未稅: (body?.專案總金額未稅 as string) ?? null,
      專案營收: (body?.專案營收 as string) ?? null,
      專案成本: (body?.專案成本 as string) ?? null,
      KOL費用未稅: (body?.KOL費用未稅 as string) ?? null,
      KOL名稱: (body?.KOL名稱 as string) ?? null,
      經紀人: (body?.經紀人 as string) ?? null,
      專案費用類型: (body?.專案費用類型 as string) ?? null,
      廠商名稱: (body?.廠商名稱 as string) ?? null,
      廠商預計付款日: (body?.廠商預計付款日 as string) ?? null,
      專案內容: (body?.專案內容 as string) ?? null,
      備註: (body?.備註 as string) ?? null,
      專案BDPM: (body?.專案BDPM as string) ?? null,
      專案BDPM分潤成數: (body?.專案BDPM分潤成數 as string) ?? null,
      專案引薦人: (body?.專案引薦人 as string) ?? null,
      專案開發人: (body?.專案開發人 as string) ?? null,
      專案管理員: (body?.專案管理員 as string) ?? null,
      執行管理員: (body?.執行管理員 as string) ?? null,
      專案資料夾: (body?.專案資料夾 as string) ?? null,
      專案引薦人分潤成數: (body?.專案引薦人分潤成數 as string) ?? null,
      專案開發人分潤成數: (body?.專案開發人分潤成數 as string) ?? null,
      專案管理員分潤成數: (body?.專案管理員分潤成數 as string) ?? null,
      執行管理員分潤成數: (body?.執行管理員分潤成數 as string) ?? null,
    };

    const master = await updateMaster(payload);
    if (master) {
      const { master_payout_defaults, payout_dedupe_rules } = await getSystemConfig();
      try {
        await syncPayoutForProject(master, master_payout_defaults, payout_dedupe_rules ?? DEFAULT_PAYOUT_DEDUPE_RULES);
        await syncFinanceForProject(master);
      } catch (e) {
        console.error("syncPayoutForProject after PATCH /api/master", e);
      }
    }
    return NextResponse.json({ ok: true, master });
  } catch (error) {
    console.error("PATCH /api/master error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

/** 刪除專案（僅董事長）；連動刪除任務、分潤表、財務之該專案資料 */
export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.user.role !== "董事長") {
    return NextResponse.json({ ok: false, error: "僅董事長可刪除專案" }, { status: 403 });
  }
  try {
    const body = (await request.json().catch(() => ({}))) as { id?: string } | null;
    const id = String(body?.id ?? "").trim();
    if (!id) {
      return NextResponse.json({ ok: false, error: "id 為必填" }, { status: 400 });
    }
    await deleteMasterProjectByRowId(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/master error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "刪除失敗" },
      { status: 500 }
    );
  }
}
