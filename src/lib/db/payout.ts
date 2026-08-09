/**
 * 分潤表 資料層（Supabase）
 * 表名：分潤表（DB 欄位為「分潤類型」）
 */

import { getSupabase } from "@/lib/supabase/server";
import { log } from "@/lib/log";
import { parsePayoutRate, parseAmount } from "@/lib/payout-utils";
import { isPayoutModeB } from "@/config/master-payout-defaults";
import type { MasterRow } from "@/lib/db/master";
import { getMasterList } from "@/lib/db/master";
import { getPartners } from "@/lib/db/partners";
import type { PartnerRow } from "@/modules/partners/types";
import { getSystemConfig, updateSystemConfig } from "@/lib/db/system-config";
import {
  applyHighestRatePerRecipient,
  EXTRA_BONUS_PAYOUT_TYPE,
  extraBonusPayoutTypeForRecipient,
  isExtraBonusPayoutType,
  normalizeRecipientForDedupe,
} from "@/lib/payout-dedupe";
import { normalizeDecimalString } from "@/lib/number-normalize";

export { EXTRA_BONUS_PAYOUT_TYPE, isExtraBonusPayoutType };

function dbErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object") {
    const e = error as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
    const msg = String(e.message ?? "").trim();
    const code = String(e.code ?? "").trim();
    if (code === "23505" || /duplicate key|unique constraint/i.test(msg)) {
      return "此專案已有相同分潤類型列（多為 DB 唯一索引限制）。請再試一次，或於 Supabase 執行 migration 060。";
    }
    if (msg) return msg;
    const details = String(e.details ?? "").trim();
    if (details) return details;
  }
  return fallback;
}

function throwDbError(error: unknown, fallback: string): never {
  throw new Error(dbErrorMessage(error, fallback));
}

export interface PayoutRow {
  id?: string;
  專案ID?: string;
  專案名稱?: string;
  專案總金額未稅?: string;
  專案營收?: string;
  /** 對應大總表「廠商預計付款日」；同步分潤時由 master 帶入 */
  廠商預計付款日?: string;
  /** 對應財務「廠商付款日期」；由 syncPayoutRowsFromFinanceDates 寫入 */
  廠商付款日期?: string;
  分潤匯款日期?: string;
  分潤類型?: string;
  分潤成數?: string;
  分潤金額?: string;
  領取人?: string;
  created_at?: string;
  [key: string]: string | undefined;
}

function rowToPayout(r: Record<string, unknown>): PayoutRow {
  const 廠商預計 =
    (r.廠商預計付款日 ?? r.專案預計匯款日 ?? r.project_expected_remit_date) as string | undefined;
  const 廠商實付 =
    (r.廠商付款日期 ?? r.專案實際入帳日期 ?? r.project_received_date) as string | undefined;
  return {
    id: r.id as string | undefined,
    專案ID: (r.專案ID ?? r.project_id) as string | undefined,
    專案名稱: (r.專案名稱 ?? r.project_name) as string | undefined,
    專案總金額未稅: normalizeDecimalString(r.專案總金額未稅 ?? r.total_amount, 2),
    專案營收: normalizeDecimalString(r.專案營收 ?? r.project_revenue, 2),
    廠商預計付款日: 廠商預計,
    廠商付款日期: 廠商實付,
    分潤匯款日期: (r.分潤匯款日期 ?? r.payout_remit_date) as string | undefined,
    分潤類型: (r.分潤類型 ?? r.角色 ?? r.payout_type) as string | undefined,
    分潤成數: normalizeDecimalString(r.分潤成數 ?? r.payout_rate, 4),
    分潤金額: normalizeDecimalString(r.分潤金額 ?? r.payout_amount, 2),
    領取人: (r.領取人 ?? r.recipient) as string | undefined,
    created_at: r.created_at as string | undefined,
  };
}

export async function getPayoutList(): Promise<PayoutRow[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("分潤表")
    .select("*")
    .order("專案ID")
    .order("分潤類型");

  if (error) {
    if (error.code === "42P01") {
      log("payout.db", "分潤表不存在，回傳空陣列", {});
      return [];
    }
    log("payout.db", "getPayoutList 查詢錯誤", { error: String(error?.message) });
    throw error;
  }

  const list = (data ?? []).map((r) => rowToPayout(r as Record<string, unknown>));

  const projectIds = [...new Set(list.map((r) => String(r.專案ID ?? "").trim()).filter(Boolean))];
  if (projectIds.length === 0) return list;

  const { data: masters, error: masterErr } = await (supabase as any)
    .from("大總表")
    .select("專案ID, 專案營收")
    .in("專案ID", projectIds);

  const revenueByProjectId = new Map<string, string>();
  if (!masterErr) {
    for (const m of masters ?? []) {
      const pid = String(m?.專案ID ?? "").trim();
      const revenue = String(m?.專案營收 ?? "").trim();
      if (pid && revenue) revenueByProjectId.set(pid, revenue);
    }
  }

  const listWithRevenue = list.map((r) => ({
    ...r,
    專案營收: r.專案營收 ?? (r.專案ID ? revenueByProjectId.get(String(r.專案ID).trim()) : undefined),
  }));

  const groupByPid = new Map<string, PayoutRow[]>();
  const pidOrder: string[] = [];
  for (const r of listWithRevenue) {
    const pid = String(r.專案ID ?? "").trim();
    if (!pid) continue;
    if (!groupByPid.has(pid)) {
      groupByPid.set(pid, []);
      pidOrder.push(pid);
    }
    groupByPid.get(pid)!.push(r);
  }

  const out: PayoutRow[] = [];
  for (const pid of pidOrder) {
    out.push(...applyHighestRatePerRecipient(groupByPid.get(pid) ?? []));
  }

  return out;
}

/**
 * 刪除某專案的自動分潤列。
 * 「額外獎金」為人工列，重算時必須保留。
 */
export async function deletePayoutBy專案ID(專案ID: string): Promise<void> {
  const supabase = getSupabase();
  const pid = String(專案ID ?? "").trim();
  if (!pid) return;

  const { data, error: selErr } = await supabase
    .from("分潤表")
    .select("id, 分潤類型")
    .eq("專案ID", pid);
  if (selErr) {
    if (selErr.code === "42P01") return;
    throwDbError(selErr, "刪除分潤列失敗");
  }

  const idsToDelete = (data ?? [])
    .filter((r) => !isExtraBonusPayoutType((r as { 分潤類型?: string }).分潤類型))
    .map((r) => String((r as { id?: string }).id ?? "").trim())
    .filter(Boolean);
  if (idsToDelete.length === 0) return;

  const { error } = await supabase.from("分潤表").delete().in("id", idsToDelete);
  if (error) {
    if (error.code === "42P01") return;
    throwDbError(error, "刪除分潤列失敗");
  }
}

/** 同步後把專案層欄位回寫至額外獎金列（金額／成數／領取人不動） */
async function refreshExtraBonusProjectFields(master: MasterRow): Promise<void> {
  const pid = String(master.專案ID ?? "").trim();
  if (!pid) return;
  const supabase = getSupabase();
  const { data, error: selErr } = await supabase
    .from("分潤表")
    .select("id, 分潤類型")
    .eq("專案ID", pid);
  if (selErr) {
    if (selErr.code === "42P01") return;
    throwDbError(selErr, "更新額外獎金專案欄位失敗");
  }
  const ids = (data ?? [])
    .filter((r) => isExtraBonusPayoutType((r as { 分潤類型?: string }).分潤類型))
    .map((r) => String((r as { id?: string }).id ?? "").trim())
    .filter(Boolean);
  if (ids.length === 0) return;

  const { error } = await supabase
    .from("分潤表")
    .update({
      專案名稱: master.專案名稱 ?? null,
      專案總金額未稅: master.專案總金額未稅 ?? null,
      專案營收: master.專案營收 ?? null,
      廠商預計付款日: master.廠商預計付款日?.trim() || null,
    })
    .in("id", ids);
  if (error && error.code !== "42P01") throwDbError(error, "更新額外獎金專案欄位失敗");
}

export async function listExtraBonusesBy專案ID(專案ID: string): Promise<PayoutRow[]> {
  const pid = String(專案ID ?? "").trim();
  if (!pid) return [];
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("分潤表")
    .select("*")
    .eq("專案ID", pid)
    .order("created_at", { ascending: true });
  if (error) {
    if (error.code === "42P01") return [];
    throwDbError(error, "讀取額外獎金失敗");
  }
  return (data ?? [])
    .map((r) => rowToPayout(r as Record<string, unknown>))
    .filter((r) => isExtraBonusPayoutType(r.分潤類型));
}

export async function createExtraBonus(input: {
  專案ID: string;
  領取人: string;
  分潤金額: string;
}): Promise<PayoutRow> {
  const pid = String(input.專案ID ?? "").trim();
  const recipient = String(input.領取人 ?? "").trim();
  const amountRaw = String(input.分潤金額 ?? "").trim();
  if (!pid) throw new Error("缺少專案ID");
  if (!recipient) throw new Error("請選擇領取人");
  const amount = parseAmount(amountRaw);
  if (!(amount > 0)) throw new Error("分潤金額須大於 0");

  const supabase = getSupabase();
  const { data: masterRaw, error: masterErr } = await supabase
    .from("大總表")
    .select("*")
    .eq("專案ID", pid)
    .maybeSingle();
  if (masterErr) throwDbError(masterErr, "讀取專案失敗");
  if (!masterRaw) throw new Error("找不到該專案");

  const master = masterRaw as Record<string, unknown>;
  const { data: finRaw } = await supabase.from("財務").select("廠商付款日期").eq("專案ID", pid).maybeSingle();
  const vendorPaid = String((finRaw as { 廠商付款日期?: unknown } | null)?.廠商付款日期 ?? "").trim() || null;

  // 使用「額外獎金｜領取人」避開舊 DB (專案ID, 分潤類型) 唯一索引（同一專案只能一筆同類型）
  const insertRow: PayoutInsertRow = {
    專案ID: pid,
    專案名稱: (master.專案名稱 as string | null | undefined) ?? null,
    專案總金額未稅: normalizeDecimalString(master.專案總金額未稅, 2) ?? null,
    專案營收: normalizeDecimalString(master.專案營收, 2) ?? null,
    廠商預計付款日: String(master.廠商預計付款日 ?? "").trim() || null,
    廠商付款日期: vendorPaid,
    分潤匯款日期: null,
    分潤類型: extraBonusPayoutTypeForRecipient(recipient),
    分潤成數: null,
    分潤金額: String(Math.round(amount)),
    領取人: recipient,
  };

  const { data, error } = await supabase.from("分潤表").insert(insertRow).select("*").maybeSingle();
  if (error) throwDbError(error, "新增額外獎金失敗");
  if (!data) throw new Error("新增額外獎金失敗");
  return rowToPayout(data as Record<string, unknown>);
}

export async function updateExtraBonus(
  id: string,
  input: { 領取人?: string; 分潤金額?: string }
): Promise<PayoutRow | null> {
  const rowId = String(id ?? "").trim();
  if (!rowId) return null;
  const supabase = getSupabase();

  const { data: existing, error: findErr } = await supabase
    .from("分潤表")
    .select("*")
    .eq("id", rowId)
    .maybeSingle();
  if (findErr) throwDbError(findErr, "讀取額外獎金失敗");
  if (!existing) return null;
  if (!isExtraBonusPayoutType((existing as Record<string, unknown>)["分潤類型"] as string)) {
    throw new Error("僅可編輯額外獎金列");
  }

  const payload: Record<string, unknown> = {};
  if (input.領取人 !== undefined) {
    const recipient = String(input.領取人 ?? "").trim();
    if (!recipient) throw new Error("請選擇領取人");
    payload.領取人 = recipient;
    payload.分潤類型 = extraBonusPayoutTypeForRecipient(recipient);
  }
  if (input.分潤金額 !== undefined) {
    const amount = parseAmount(input.分潤金額);
    if (!(amount > 0)) throw new Error("分潤金額須大於 0");
    payload.分潤金額 = String(Math.round(amount));
  }
  if (Object.keys(payload).length === 0) {
    return rowToPayout(existing as Record<string, unknown>);
  }

  const { data, error } = await supabase
    .from("分潤表")
    .update(payload)
    .eq("id", rowId)
    .select("*")
    .maybeSingle();
  if (error) throwDbError(error, "更新額外獎金失敗");
  if (data && !isExtraBonusPayoutType((data as Record<string, unknown>)["分潤類型"] as string)) {
    throw new Error("僅可編輯額外獎金列");
  }
  return data ? rowToPayout(data as Record<string, unknown>) : null;
}

export async function deleteExtraBonus(id: string): Promise<boolean> {
  const rowId = String(id ?? "").trim();
  if (!rowId) return false;
  const supabase = getSupabase();
  const { data: existing, error: findErr } = await supabase
    .from("分潤表")
    .select("id, 分潤類型")
    .eq("id", rowId)
    .maybeSingle();
  if (findErr) {
    if (findErr.code === "42P01") return false;
    throwDbError(findErr, "刪除額外獎金失敗");
  }
  if (!existing || !isExtraBonusPayoutType((existing as Record<string, unknown>)["分潤類型"] as string)) {
    return false;
  }
  const { data, error } = await supabase
    .from("分潤表")
    .delete()
    .eq("id", rowId)
    .select("id")
    .maybeSingle();
  if (error) {
    if (error.code === "42P01") return false;
    throwDbError(error, "刪除額外獎金失敗");
  }
  return Boolean(data);
}

/** 一筆分潤列（寫入 DB 用） */
export interface PayoutInsertRow {
  專案ID: string;
  專案名稱: string | null;
  專案總金額未稅: string | null;
  專案營收: string | null;
  廠商預計付款日: string | null;
  廠商付款日期: string | null;
  分潤匯款日期: string | null;
  分潤類型: string;
  分潤成數: string | null;
  分潤金額: string | null;
  領取人: string | null;
}

export async function insertPayoutRows(rows: PayoutInsertRow[]): Promise<void> {
  if (rows.length === 0) return;
  const supabase = getSupabase();
  const { error } = await supabase.from("分潤表").insert(rows);
  if (error) throw error;
}

type PayoutDefaults = Record<string, string>;

/** 同步前依「領取人」保留分潤匯款日（去重後仍對應同一人） */
async function snapshotRemitDatesByRecipient(專案ID: string): Promise<Map<string, string>> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("分潤表")
    .select('"領取人", "分潤匯款日期"')
    .eq("專案ID", 專案ID);
  if (error) {
    if (error.code === "42P01") return new Map();
    throw error;
  }
  const out = new Map<string, string>();
  for (const r of data ?? []) {
    const remit = String((r as Record<string, unknown>)["分潤匯款日期"] ?? "").trim();
    if (!remit) continue;
    const key = normalizeRecipientForDedupe((r as Record<string, unknown>)["領取人"] as string | null) || "__empty__";
    out.set(key, remit);
  }
  return out;
}

async function restoreRemitDatesByRecipient(專案ID: string, snapshots: Map<string, string>): Promise<void> {
  if (snapshots.size === 0) return;
  const supabase = getSupabase();
  const { data, error } = await supabase.from("分潤表").select('id, "領取人"').eq("專案ID", 專案ID);
  if (error) {
    if (error.code === "42P01") return;
    throw error;
  }
  for (const r of data ?? []) {
    const id = String((r as Record<string, unknown>).id ?? "").trim();
    if (!id) continue;
    const key =
      normalizeRecipientForDedupe((r as Record<string, unknown>)["領取人"] as string | null) || "__empty__";
    const remit = snapshots.get(key);
    if (!remit) continue;
    const { error: upErr } = await supabase.from("分潤表").update({ 分潤匯款日期: remit }).eq("id", id);
    if (upErr && upErr.code !== "42P01") throw upErr;
  }
}

async function buildPayoutRowsForMaster(
  master: MasterRow,
  defaults: PayoutDefaults,
  partners?: PartnerRow[]
): Promise<PayoutInsertRow[]> {
  const 專案ID = master.專案ID ?? "";
  const 專案名稱 = master.專案名稱 ?? null;
  const 專案總金額未稅 = master.專案總金額未稅 ?? null;
  const 專案營收 = master.專案營收 ?? null;
  const amount = parseAmount(專案營收 ?? 專案總金額未稅);
  const 專案類型 = (master.專案類型 ?? "").trim();
  const 廠商預計付款日 = master.廠商預計付款日?.trim() || null;
  const rows: PayoutInsertRow[] = [];

  if (isPayoutModeB(專案類型)) {
    const 專案開發人 = master.專案開發人 ?? null;
    const rateStr開發人 = master.專案開發人分潤成數 ?? defaults.專案開發人分潤成數;
    const rate開發人 = parsePayoutRate(rateStr開發人);
    if (專案開發人) {
      rows.push({
        專案ID,
        專案名稱,
        專案總金額未稅,
        專案營收,
        廠商預計付款日,
        廠商付款日期: null,
        分潤匯款日期: null,
        分潤類型: "專案開發人",
        分潤成數: rateStr開發人 ?? null,
        分潤金額: String(Math.round(amount * rate開發人)),
        領取人: 專案開發人,
      });
    }
    const partnerList = partners ?? (await getPartners());
    const kol = master.KOL名稱?.trim()
      ? partnerList.find((p) => (p.合作夥伴名稱 ?? "").trim() === (master.KOL名稱 ?? "").trim())
      : null;
    const roles: Array<{ key: keyof PayoutDefaults; 分潤類型: string; 領取人: string | null }> = [
      { key: "經紀人分潤成數", 分潤類型: "經紀人", 領取人: master.經紀人?.trim() || null },
      {
        key: "主管分潤成數",
        分潤類型: "主管",
        領取人: master.主管?.trim() || kol?.主管?.trim() || null,
      },
      {
        key: "KOL開發者分潤成數",
        分潤類型: "KOL開發者",
        領取人: master.KOL開發者?.trim() || kol?.KOL開發者?.trim() || null,
      },
    ];
    for (const { key, 分潤類型, 領取人 } of roles) {
      if (!領取人) continue;
      const rate = parsePayoutRate(defaults[key]);
      rows.push({
        專案ID,
        專案名稱,
        專案總金額未稅,
        專案營收,
        廠商預計付款日,
        廠商付款日期: null,
        分潤匯款日期: null,
        分潤類型,
        分潤成數: defaults[key] ?? null,
        分潤金額: String(Math.round(amount * rate)),
        領取人,
      });
    }
  } else {
    const modeARoles: Array<{
      key: keyof PayoutDefaults;
      分潤類型: string;
      領取人: string | null;
      成數FromMaster: string | null;
    }> = [
      { key: "專案BDPM分潤成數", 分潤類型: "專案BDPM", 領取人: master.專案BDPM ?? null, 成數FromMaster: master.專案BDPM分潤成數 ?? null },
      { key: "專案引薦人分潤成數", 分潤類型: "專案引薦人", 領取人: master.專案引薦人 ?? null, 成數FromMaster: master.專案引薦人分潤成數 ?? null },
      { key: "專案管理員分潤成數", 分潤類型: "專案管理員", 領取人: master.專案管理員 ?? null, 成數FromMaster: master.專案管理員分潤成數 ?? null },
      { key: "執行管理員分潤成數", 分潤類型: "執行管理員", 領取人: master.執行管理員 ?? null, 成數FromMaster: master.執行管理員分潤成數 ?? null },
    ];
    for (const { key, 分潤類型, 領取人, 成數FromMaster } of modeARoles) {
      if (!領取人) continue;
      const rateStr = 成數FromMaster ?? defaults[key];
      const rate = parsePayoutRate(rateStr);
      rows.push({
        專案ID,
        專案名稱,
        專案總金額未稅,
        專案營收,
        廠商預計付款日,
        廠商付款日期: null,
        分潤匯款日期: null,
        分潤類型,
        分潤成數: rateStr ?? null,
        分潤金額: String(Math.round(amount * rate)),
        領取人,
      });
    }
  }

  return rows;
}

export type SyncPayoutForProjectOptions = {
  partners?: PartnerRow[];
  /** 單專案同步時補回廠商付款日；全量重算由 syncAllPayoutsFromMaster 批次處理 */
  restoreVendorDates?: boolean;
};

/**
 * 依大總表一筆專案與成數預設，產生分潤列並同步至分潤表
 * （刪除自動分潤列後再插入；「額外獎金」人工列會保留）
 * 分潤金額基準：專案營收（未填則用專案總金額未稅）
 */
export async function syncPayoutForProject(
  master: MasterRow,
  defaults: PayoutDefaults,
  options?: SyncPayoutForProjectOptions
): Promise<void> {
  const 專案ID = master.專案ID ?? "";
  const remitByRecipient = await snapshotRemitDatesByRecipient(專案ID);

  await deletePayoutBy專案ID(專案ID);

  const rows = await buildPayoutRowsForMaster(master, defaults, options?.partners);
  const filteredRows = applyHighestRatePerRecipient(rows);
  if (filteredRows.length > 0) await insertPayoutRows(filteredRows);

  await refreshExtraBonusProjectFields(master);
  await restoreRemitDatesByRecipient(專案ID, remitByRecipient);

  if (options?.restoreVendorDates !== false) {
    const { syncFinanceVendorDateFromInvoicesForProject } = await import("@/lib/db/finance");
    await syncFinanceVendorDateFromInvoicesForProject(專案ID);
  }
}

export function todayDateStringLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 財務逐列勾選：更新單筆分潤匯款日期，並回寫專案財務「員工分潤日期」 */
export async function updatePayoutRemitDate(
  id: string,
  分潤匯款日期: string | null
): Promise<PayoutRow | null> {
  const rowId = String(id ?? "").trim();
  if (!rowId) return null;
  const supabase = getSupabase();
  const remit = 分潤匯款日期 == null || String(分潤匯款日期).trim() === "" ? null : String(分潤匯款日期).trim();

  const { data, error } = await supabase
    .from("分潤表")
    .update({ 分潤匯款日期: remit })
    .eq("id", rowId)
    .select("*")
    .maybeSingle();
  if (error || !data) return null;

  const row = rowToPayout(data as Record<string, unknown>);
  const pid = String(row.專案ID ?? "").trim();
  if (pid) {
    const { syncFinanceEmployeeDateFromPayoutRows } = await import("@/lib/db/finance");
    await syncFinanceEmployeeDateFromPayoutRows(pid);
  }
  return row;
}

/** 分潤計算基準版本；變更公式時遞增，觸發全量重算 */
export const PAYOUT_CALC_VERSION = "project_revenue_v1";

async function getStoredPayoutCalcVersion(): Promise<string | null> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("system_config")
    .select("value")
    .eq("key", "payout_calc_version")
    .maybeSingle();
  const v = (data as { value?: unknown } | null)?.value;
  return typeof v === "string" ? v : null;
}

export async function isPayoutCalcStale(): Promise<boolean> {
  const stored = await getStoredPayoutCalcVersion();
  return stored !== PAYOUT_CALC_VERSION;
}

async function markPayoutCalcVersionCurrent(): Promise<void> {
  await updateSystemConfig("payout_calc_version", PAYOUT_CALC_VERSION);
}

/** 依大總表重算全部分潤並標記計算版本為最新 */
export async function runPayoutResyncAndMarkCurrent(): Promise<{ synced: number; failed: number }> {
  const result = await syncAllPayoutsFromMaster();
  await markPayoutCalcVersionCurrent();
  return result;
}

export async function syncAllPayoutsFromMaster(): Promise<{ synced: number; failed: number }> {
  const { master_payout_defaults } = await getSystemConfig();
  const masters = await getMasterList();
  const partners = await getPartners();
  let synced = 0;
  let failed = 0;
  for (const master of masters) {
    try {
      await syncPayoutForProject(master, master_payout_defaults, {
        partners,
        restoreVendorDates: false,
      });
      synced += 1;
    } catch (e) {
      failed += 1;
      log("payout.syncAll", "syncPayoutForProject 失敗", { 專案ID: master.專案ID, error: String(e) });
    }
  }
  try {
    const { syncAllFinanceVendorDatesFromInvoices } = await import("@/lib/db/finance");
    await syncAllFinanceVendorDatesFromInvoices();
  } catch (e) {
    log("payout.syncAll", "syncAllFinanceVendorDatesFromInvoices 失敗", { error: String(e) });
  }
  return { synced, failed };
}
