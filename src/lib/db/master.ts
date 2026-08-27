/**
 * 大總表 資料層（Supabase）
 * 讀取 public."大總表"
 */

import { getSupabase } from "@/lib/supabase/server";
import { log } from "@/lib/log";
import { normalizeDecimalString } from "@/lib/number-normalize";
import { calc專案營收 } from "@/config/project-types";

export interface MasterRow {
  id: string;
  專案ID: string;
  專案名稱: string | null;
  專案類型: string | null;
  專案狀態: string | null;
  長期案: boolean;
  /** 母專案的專案ID（子專案用；NULL 代表獨立或母專案） */
  母專案ID: string | null;
  /** 合約雲端連結（全款以合約為準） */
  合約連結: string | null;
  狀態確認日期: string | null;
  開案日期: string | null;
  專案總金額未稅: string | null;
  專案營收: string | null;
  專案成本: string | null;
  KOL費用未稅: string | null;
  KOL名稱: string | null;
  /** 廣告業配（模式 B）：專案手填；分潤「經紀人」領取人以此為準 */
  經紀人: string | null;
  /** 模式 B：主管（專案手填；選 KOL 時可預填合作夥伴值） */
  主管: string | null;
  /** 模式 B：KOL引薦人（專案手填；DB 欄位名 KOL開發者） */
  KOL開發者: string | null;
  專案費用類型: string | null;
  廠商名稱: string | null;
  /** 可編輯；同步至財務與分潤表「廠商預計付款日」 */
  廠商預計付款日: string | null;
  專案內容: string | null;
  備註: string | null;
  專案BDPM: string | null;
  專案BDPM分潤成數: string | null;
  專案引薦人: string | null;
  /** 分潤模式 B（廣告業配）人員；與模式 A「專案引薦人」分開 */
  專案開發人: string | null;
  專案管理員: string | null;
  執行管理員: string | null;
  專案資料夾: string | null;
  專案引薦人分潤成數: string | null;
  /** 模式 B 專用成數預設鍵：專案開發人分潤成數 */
  專案開發人分潤成數: string | null;
  專案管理員分潤成數: string | null;
  執行管理員分潤成數: string | null;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
  deleted_by?: string | null;
  delete_reason?: string | null;
}

function rowToMaster(r: Record<string, unknown>): MasterRow {
  const money = (v: unknown) => normalizeDecimalString(v, 2) ?? null;
  return {
    id: String(r.id ?? ""),
    專案ID: String(r.專案ID ?? ""),
    專案名稱: (r.專案名稱 as string) ?? null,
    專案類型: (r.專案類型 as string) ?? null,
    專案狀態: (r.專案狀態 as string) ?? null,
    長期案: Boolean(r.長期案),
    母專案ID: (r.母專案ID as string) ?? null,
    合約連結: (r.合約連結 as string) ?? null,
    狀態確認日期: (r.狀態確認日期 as string) ?? null,
    開案日期: (r.開案日期 as string) ?? null,
    專案總金額未稅: money(r.專案總金額未稅),
    專案營收: money(r.專案營收),
    專案成本: money(r.專案成本),
    KOL費用未稅: money(r.KOL費用未稅),
    KOL名稱: (r.KOL名稱 as string) ?? null,
    經紀人: (r.經紀人 as string) ?? null,
    主管: (r.主管 as string) ?? null,
    KOL開發者: (r.KOL開發者 as string) ?? null,
    專案費用類型: (r.專案費用類型 as string) ?? null,
    廠商名稱: (r.廠商名稱 as string) ?? null,
    廠商預計付款日: (r.廠商預計付款日 as string) ?? null,
    專案內容: (r.專案內容 as string) ?? null,
    備註: (r.備註 as string) ?? null,
    專案BDPM: (r.專案BDPM as string) ?? null,
    專案BDPM分潤成數: (r.專案BDPM分潤成數 as string) ?? null,
    專案引薦人: (r.專案引薦人 as string) ?? null,
    專案開發人: (r.專案開發人 as string) ?? null,
    專案管理員: (r.專案管理員 as string) ?? null,
    執行管理員: (r.執行管理員 as string) ?? null,
    專案資料夾: (r.專案資料夾 as string) ?? null,
    專案引薦人分潤成數: (r.專案引薦人分潤成數 as string) ?? null,
    專案開發人分潤成數: (r.專案開發人分潤成數 as string) ?? null,
    專案管理員分潤成數: (r.專案管理員分潤成數 as string) ?? null,
    執行管理員分潤成數: (r.執行管理員分潤成數 as string) ?? null,
    created_at: r.created_at as string | undefined,
    updated_at: r.updated_at as string | undefined,
    deleted_at: (r.deleted_at as string) ?? null,
    deleted_by: (r.deleted_by as string) ?? null,
    delete_reason: (r.delete_reason as string) ?? null,
  };
}

function normalizeMoneyOrNull(v: string | null | undefined): string | null {
  if (v == null) return null;
  const normalized = normalizeDecimalString(v, 2);
  if (normalized == null) return null;
  const t = String(normalized).trim();
  return t === "" ? null : t;
}

export async function getMasterList(): Promise<MasterRow[]> {
  const supabase = getSupabase();
  const withSoft = await supabase
    .from("大總表")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (!withSoft.error && withSoft.data) {
    log("master.db", "getMasterList 筆數", { count: withSoft.data.length });
    return withSoft.data.map((r) => rowToMaster(r as Record<string, unknown>));
  }

  const softMsg = withSoft.error?.message ?? "";
  if (/deleted_at|schema cache|column/i.test(softMsg)) {
    const { data, error } = await supabase.from("大總表").select("*").order("created_at", { ascending: false });
    if (error) {
      log("master.db", "getMasterList 查詢錯誤", { error: String(error?.message) });
      throw error;
    }
    const rows = (data ?? [])
      .map((r) => rowToMaster(r as Record<string, unknown>))
      .filter((r) => !r.deleted_at);
    log("master.db", "getMasterList 筆數（無 soft 欄位）", { count: rows.length });
    return rows;
  }

  log("master.db", "getMasterList 查詢錯誤", { error: softMsg });
  throw withSoft.error;
}

export async function getMasterById(id: string, options?: { includeDeleted?: boolean }): Promise<MasterRow | null> {
  const rowId = String(id ?? "").trim();
  if (!rowId) return null;
  const { data, error } = await getSupabase().from("大總表").select("*").eq("id", rowId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = rowToMaster(data as Record<string, unknown>);
  if (!options?.includeDeleted && row.deleted_at) return null;
  return row;
}

export type NewMasterInput = Omit<MasterRow, "id" | "created_at" | "updated_at">;

export async function createMaster(payload: NewMasterInput): Promise<MasterRow> {
  if (!payload.專案ID || !String(payload.專案ID).trim()) {
    throw new Error("專案ID 為必填");
  }

  const insertData: Record<string, unknown> = {
    專案ID: payload.專案ID,
    專案名稱: payload.專案名稱 ?? null,
    專案類型: payload.專案類型 ?? null,
    專案狀態: payload.專案狀態 ?? null,
    長期案: Boolean(payload.長期案),
    母專案ID: payload.母專案ID ? String(payload.母專案ID).trim() : null,
    合約連結: payload.合約連結 ?? null,
    狀態確認日期: payload.狀態確認日期 ?? null,
    開案日期: payload.開案日期 ?? null,
    專案總金額未稅: normalizeMoneyOrNull(payload.專案總金額未稅),
    /** 專案營收：總金額 − 額外成本 − KOL費用，不接受前端手填 */
    專案營收: normalizeMoneyOrNull(
      calc專案營收(payload.專案總金額未稅, payload.專案成本, payload.KOL費用未稅)
    ),
    專案成本: normalizeMoneyOrNull(payload.專案成本),
    KOL費用未稅: normalizeMoneyOrNull(payload.KOL費用未稅),
    KOL名稱: payload.KOL名稱 ?? null,
    經紀人: payload.經紀人 ?? null,
    主管: payload.主管 ?? null,
    KOL開發者: payload.KOL開發者 ?? null,
    專案費用類型: payload.專案費用類型 ?? null,
    廠商名稱: payload.廠商名稱 ?? null,
    廠商預計付款日: payload.廠商預計付款日 ?? null,
    專案內容: payload.專案內容 ?? null,
    備註: payload.備註 ?? null,
    專案BDPM: payload.專案BDPM ?? null,
    專案BDPM分潤成數: payload.專案BDPM分潤成數 ?? null,
    專案引薦人: payload.專案引薦人 ?? null,
    專案開發人: payload.專案開發人 ?? null,
    專案管理員: payload.專案管理員 ?? null,
    執行管理員: payload.執行管理員 ?? null,
    專案資料夾: payload.專案資料夾 ?? null,
    專案引薦人分潤成數: payload.專案引薦人分潤成數 ?? null,
    專案開發人分潤成數: payload.專案開發人分潤成數 ?? null,
    專案管理員分潤成數: payload.專案管理員分潤成數 ?? null,
    執行管理員分潤成數: payload.執行管理員分潤成數 ?? null,
  };

  const { data, error } = await getSupabase()
    .from("大總表")
    .insert(insertData)
    .select("*")
    .maybeSingle();

  if (error) {
    log("master.db", "createMaster 新增失敗", { error: String(error?.message) });
    throw error;
  }
  if (!data) {
    throw new Error("新增大總表失敗，未取得資料");
  }
  const row = rowToMaster(data as Record<string, unknown>);
  log("master.db", "createMaster 成功", { 專案ID: row.專案ID });
  return row;
}

export type UpdateMasterInput = Partial<Omit<MasterRow, "id" | "created_at" | "updated_at">> & { id: string };

export async function updateMaster(payload: UpdateMasterInput): Promise<MasterRow> {
  const id = String(payload.id ?? "").trim();
  if (!id) throw new Error("id 為必填");

  const updateData: Record<string, unknown> = {
    專案名稱: payload.專案名稱 ?? null,
    專案類型: payload.專案類型 ?? null,
    專案狀態: payload.專案狀態 ?? null,
    長期案: Boolean(payload.長期案),
    狀態確認日期: payload.狀態確認日期 ?? null,
    開案日期: payload.開案日期 ?? null,
    專案總金額未稅: normalizeMoneyOrNull(payload.專案總金額未稅),
    /** 專案營收：總金額 − 額外成本 − KOL費用，不接受前端手填 */
    專案營收: normalizeMoneyOrNull(
      calc專案營收(payload.專案總金額未稅, payload.專案成本, payload.KOL費用未稅)
    ),
    專案成本: normalizeMoneyOrNull(payload.專案成本),
    KOL費用未稅: normalizeMoneyOrNull(payload.KOL費用未稅),
    KOL名稱: payload.KOL名稱 ?? null,
    經紀人: payload.經紀人 ?? null,
    主管: payload.主管 ?? null,
    KOL開發者: payload.KOL開發者 ?? null,
    專案費用類型: payload.專案費用類型 ?? null,
    廠商名稱: payload.廠商名稱 ?? null,
    廠商預計付款日: payload.廠商預計付款日 ?? null,
    專案內容: payload.專案內容 ?? null,
    備註: payload.備註 ?? null,
    專案BDPM: payload.專案BDPM ?? null,
    專案引薦人: payload.專案引薦人 ?? null,
    專案開發人: payload.專案開發人 ?? null,
    專案管理員: payload.專案管理員 ?? null,
    執行管理員: payload.執行管理員 ?? null,
    專案資料夾: payload.專案資料夾 ?? null,
    updated_at: new Date().toISOString(),
  };
  // 母專案ID／合約連結：僅在有傳入時才更新，避免行內部分更新誤清空
  if (payload.母專案ID !== undefined) {
    updateData.母專案ID = payload.母專案ID ? String(payload.母專案ID).trim() : null;
  }
  if (payload.合約連結 !== undefined) updateData.合約連結 = payload.合約連結 ?? null;

  // 分潤成數僅由 Config 控制，前端不可修改，PATCH 時不更新
  if (payload.專案BDPM分潤成數 !== undefined) updateData.專案BDPM分潤成數 = payload.專案BDPM分潤成數 ?? null;
  if (payload.專案引薦人分潤成數 !== undefined) updateData.專案引薦人分潤成數 = payload.專案引薦人分潤成數 ?? null;
  if (payload.專案開發人分潤成數 !== undefined) updateData.專案開發人分潤成數 = payload.專案開發人分潤成數 ?? null;
  if (payload.專案管理員分潤成數 !== undefined) updateData.專案管理員分潤成數 = payload.專案管理員分潤成數 ?? null;
  if (payload.執行管理員分潤成數 !== undefined) updateData.執行管理員分潤成數 = payload.執行管理員分潤成數 ?? null;

  const { data, error } = await getSupabase()
    .from("大總表")
    .update(updateData)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    log("master.db", "updateMaster 更新失敗", { id, error: String(error?.message) });
    throw error;
  }
  if (!data) {
    throw new Error("更新大總表失敗，未取得資料");
  }
  const row = rowToMaster(data as Record<string, unknown>);
  log("master.db", "updateMaster 成功", { id, 專案ID: row.專案ID });
  return row;
}
