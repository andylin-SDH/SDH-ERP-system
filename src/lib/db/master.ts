/**
 * 大總表 資料層（Supabase）
 * 讀取 public."大總表"
 */

import { getSupabase } from "@/lib/supabase/server";
import { log } from "@/lib/log";

export interface MasterRow {
  id: string;
  專案ID: string;
  專案名稱: string | null;
  專案類型: string | null;
  專案狀態: string | null;
  狀態確認日期: string | null;
  開案日期: string | null;
  專案總金額未稅: string | null;
  專案營收: string | null;
  專案成本: string | null;
  KOL費用未稅: string | null;
  KOL名稱: string | null;
  專案費用類型: string | null;
  廠商名稱: string | null;
  /** 可編輯；同步至財務與分潤表「廠商預計付款日」 */
  廠商預計付款日: string | null;
  專案內容: string | null;
  備註: string | null;
  專案BDPM: string | null;
  專案BDPM分潤成數: string | null;
  專案引薦人: string | null;
  專案管理員: string | null;
  執行管理員: string | null;
  專案資料夾: string | null;
  專案引薦人分潤成數: string | null;
  專案管理員分潤成數: string | null;
  執行管理員分潤成數: string | null;
  created_at?: string;
  updated_at?: string;
}

function rowToMaster(r: Record<string, unknown>): MasterRow {
  return {
    id: String(r.id ?? ""),
    專案ID: String(r.專案ID ?? ""),
    專案名稱: (r.專案名稱 as string) ?? null,
    專案類型: (r.專案類型 as string) ?? null,
    專案狀態: (r.專案狀態 as string) ?? null,
    狀態確認日期: (r.狀態確認日期 as string) ?? null,
    開案日期: (r.開案日期 as string) ?? null,
    專案總金額未稅: (r.專案總金額未稅 as string) ?? null,
    專案營收: (r.專案營收 as string) ?? null,
    專案成本: (r.專案成本 as string) ?? null,
    KOL費用未稅: (r.KOL費用未稅 as string) ?? null,
    KOL名稱: (r.KOL名稱 as string) ?? null,
    專案費用類型: (r.專案費用類型 as string) ?? null,
    廠商名稱: (r.廠商名稱 as string) ?? null,
    廠商預計付款日: (r.廠商預計付款日 as string) ?? null,
    專案內容: (r.專案內容 as string) ?? null,
    備註: (r.備註 as string) ?? null,
    專案BDPM: (r.專案BDPM as string) ?? null,
    專案BDPM分潤成數: (r.專案BDPM分潤成數 as string) ?? null,
    專案引薦人: (r.專案引薦人 as string) ?? null,
    專案管理員: (r.專案管理員 as string) ?? null,
    執行管理員: (r.執行管理員 as string) ?? null,
    專案資料夾: (r.專案資料夾 as string) ?? null,
    專案引薦人分潤成數: (r.專案引薦人分潤成數 as string) ?? null,
    專案管理員分潤成數: (r.專案管理員分潤成數 as string) ?? null,
    執行管理員分潤成數: (r.執行管理員分潤成數 as string) ?? null,
    created_at: r.created_at as string | undefined,
    updated_at: r.updated_at as string | undefined,
  };
}

export async function getMasterList(): Promise<MasterRow[]> {
  const { data, error } = await getSupabase()
    .from("大總表")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    log("master.db", "getMasterList 查詢錯誤", { error: String(error?.message) });
    throw error;
  }
  log("master.db", "getMasterList 筆數", { count: (data ?? []).length });
  return (data ?? []).map((r) => rowToMaster(r as Record<string, unknown>));
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
    狀態確認日期: payload.狀態確認日期 ?? null,
    開案日期: payload.開案日期 ?? null,
    專案總金額未稅: payload.專案總金額未稅 ?? null,
    專案營收: payload.專案營收 ?? null,
    專案成本: payload.專案成本 ?? null,
    KOL費用未稅: payload.KOL費用未稅 ?? null,
    KOL名稱: payload.KOL名稱 ?? null,
    專案費用類型: payload.專案費用類型 ?? null,
    廠商名稱: payload.廠商名稱 ?? null,
    廠商預計付款日: payload.廠商預計付款日 ?? null,
    專案內容: payload.專案內容 ?? null,
    備註: payload.備註 ?? null,
    專案BDPM: payload.專案BDPM ?? null,
    專案BDPM分潤成數: payload.專案BDPM分潤成數 ?? null,
    專案引薦人: payload.專案引薦人 ?? null,
    專案管理員: payload.專案管理員 ?? null,
    執行管理員: payload.執行管理員 ?? null,
    專案資料夾: payload.專案資料夾 ?? null,
    專案引薦人分潤成數: payload.專案引薦人分潤成數 ?? null,
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
    狀態確認日期: payload.狀態確認日期 ?? null,
    開案日期: payload.開案日期 ?? null,
    專案總金額未稅: payload.專案總金額未稅 ?? null,
    專案營收: payload.專案營收 ?? null,
    專案成本: payload.專案成本 ?? null,
    KOL費用未稅: payload.KOL費用未稅 ?? null,
    KOL名稱: payload.KOL名稱 ?? null,
    專案費用類型: payload.專案費用類型 ?? null,
    廠商名稱: payload.廠商名稱 ?? null,
    廠商預計付款日: payload.廠商預計付款日 ?? null,
    專案內容: payload.專案內容 ?? null,
    備註: payload.備註 ?? null,
    專案BDPM: payload.專案BDPM ?? null,
    專案引薦人: payload.專案引薦人 ?? null,
    專案管理員: payload.專案管理員 ?? null,
    執行管理員: payload.執行管理員 ?? null,
    專案資料夾: payload.專案資料夾 ?? null,
    updated_at: new Date().toISOString(),
  };
  // 分潤成數僅由 Config 控制，前端不可修改，PATCH 時不更新
  if (payload.專案BDPM分潤成數 !== undefined) updateData.專案BDPM分潤成數 = payload.專案BDPM分潤成數 ?? null;
  if (payload.專案引薦人分潤成數 !== undefined) updateData.專案引薦人分潤成數 = payload.專案引薦人分潤成數 ?? null;
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
