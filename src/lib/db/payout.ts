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
import { getSystemConfig } from "@/lib/db/system-config";
import { applyHighestRatePerRecipient, normalizeRecipientForDedupe } from "@/lib/payout-dedupe";
import { normalizeDecimalString } from "@/lib/number-normalize";

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

/** 刪除某專案的所有分潤列 */
export async function deletePayoutBy專案ID(專案ID: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("分潤表").delete().eq("專案ID", 專案ID);
  if (error) {
    if (error.code === "42P01") return;
    throw error;
  }
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

async function buildPayoutRowsForMaster(master: MasterRow, defaults: PayoutDefaults): Promise<PayoutInsertRow[]> {
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
    const partners = await getPartners();
    const kol = master.KOL名稱?.trim()
      ? partners.find((p) => (p.合作夥伴名稱 ?? "").trim() === (master.KOL名稱 ?? "").trim())
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

/**
 * 依大總表一筆專案與成數預設，產生分潤列並同步至分潤表（先刪該專案舊列再插入）
 * 分潤金額基準：專案營收（未填則用專案總金額未稅）
 */
export async function syncPayoutForProject(master: MasterRow, defaults: PayoutDefaults): Promise<void> {
  const 專案ID = master.專案ID ?? "";
  const remitByRecipient = await snapshotRemitDatesByRecipient(專案ID);

  await deletePayoutBy專案ID(專案ID);

  const rows = await buildPayoutRowsForMaster(master, defaults);
  const filteredRows = applyHighestRatePerRecipient(rows);
  if (filteredRows.length > 0) await insertPayoutRows(filteredRows);

  await restoreRemitDatesByRecipient(專案ID, remitByRecipient);

  const { syncFinanceVendorDateFromInvoicesForProject } = await import("@/lib/db/finance");
  await syncFinanceVendorDateFromInvoicesForProject(專案ID);
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

export async function syncAllPayoutsFromMaster(): Promise<void> {
  const { master_payout_defaults } = await getSystemConfig();
  const masters = await getMasterList();
  for (const master of masters) {
    try {
      await syncPayoutForProject(master, master_payout_defaults);
    } catch (e) {
      log("payout.syncAll", "syncPayoutForProject 失敗", { 專案ID: master.專案ID, error: String(e) });
    }
  }
}
