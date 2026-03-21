/**
 * 分潤表 資料層（Supabase）
 * 表名：分潤表（DB 欄位為「分潤類型」）
 */

import { getSupabase } from "@/lib/supabase/server";
import { log } from "@/lib/log";
import { parsePayoutRate, parseAmount } from "@/lib/payout-utils";
import { isPayoutModeB } from "@/config/master-payout-defaults";
import type { MasterRow } from "@/lib/db/master";
import { getPartners } from "@/lib/db/partners";
import type { PayoutDedupeRule } from "@/lib/db/system-config";

export interface PayoutRow {
  id?: string;
  專案ID?: string;
  專案名稱?: string;
  專案總金額未稅?: string;
  專案營收?: string;
  分潤類型?: string;
  分潤成數?: string;
  分潤金額?: string;
  領取人?: string;
  created_at?: string;
  [key: string]: string | undefined;
}

function rowToPayout(r: Record<string, unknown>): PayoutRow {
  return {
    id: r.id as string | undefined,
    專案ID: (r.專案ID ?? r.project_id) as string | undefined,
    專案名稱: (r.專案名稱 ?? r.project_name) as string | undefined,
    專案總金額未稅: (r.專案總金額未稅 ?? r.total_amount) as string | undefined,
     專案營收: (r.專案營收 ?? r.project_revenue) as string | undefined,
    分潤類型: (r.分潤類型 ?? r.角色 ?? r.payout_type) as string | undefined,
    分潤成數: (r.分潤成數 ?? r.payout_rate) as string | undefined,
    分潤金額: (r.分潤金額 ?? r.payout_amount) as string | undefined,
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

  // 舊資料可能尚未回填「專案營收」；讀取時用 專案ID 從大總表補值
  const missingRevenueIds = [...new Set(list.filter((r) => !r.專案營收 && r.專案ID).map((r) => r.專案ID!))];
  if (missingRevenueIds.length === 0) return list;

  // NOTE: Supabase 的型別推斷在中文欄位 select 時可能出現 ParserError
  // 這裡用 any 來避免 build 失敗，實際 runtime 仍會回傳資料列
  const { data: masters, error: masterErr } = await (supabase as any)
    .from("大總表")
    .select("專案ID, 專案營收")
    .in("專案ID", missingRevenueIds);
  if (masterErr) return list;

  const revenueByProjectId = new Map<string, string>();
  for (const m of masters ?? []) {
    const pid = String(m?.專案ID ?? "").trim();
    const revenue = String(m?.專案營收 ?? "").trim();
    if (pid) revenueByProjectId.set(pid, revenue);
  }

  return list.map((r) => ({
    ...r,
    專案營收: r.專案營收 ?? (r.專案ID ? revenueByProjectId.get(r.專案ID) : undefined),
  }));
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

/**
 * 套用「同一人不重複計算」規則：當多角色為同一人時，只保留指定角色
 */
function applyDedupeRules(
  rows: PayoutInsertRow[],
  rules: PayoutDedupeRule[]
): PayoutInsertRow[] {
  if (rules.length === 0) return rows;
  let result = [...rows];
  for (const rule of rules) {
    const roleSet = new Set(rule.roles);
    if (!roleSet.has(rule.keep) || rule.roles.length < 2) continue;
    result = result.filter((row) => {
      if (!roleSet.has(row.分潤類型)) return true;
      const recipient = (row.領取人 ?? "").trim();
      if (!recipient) return true;
      const sameRecipient = result.filter(
        (r) => roleSet.has(r.分潤類型) && (r.領取人 ?? "").trim() === recipient
      );
      if (sameRecipient.length < 2) return true;
      return row.分潤類型 === rule.keep;
    });
  }
  return result;
}

/**
 * 依大總表一筆專案與成數預設，產生分潤列並同步至分潤表（先刪該專案舊列再插入）
 */
export async function syncPayoutForProject(
  master: MasterRow,
  defaults: PayoutDefaults,
  dedupeRules: PayoutDedupeRule[] = []
): Promise<void> {
  const 專案ID = master.專案ID ?? "";
  const 專案名稱 = master.專案名稱 ?? null;
  const 專案總金額未稅 = master.專案總金額未稅 ?? null;
  const 專案營收 = master.專案營收 ?? null;
  // 分潤金額一律以「專案營收」為基準；若尚未填寫專案營收，退回用專案總金額未稅
  const amount = parseAmount(專案營收 ?? 專案總金額未稅);
  const 專案類型 = (master.專案類型 ?? "").trim();

  await deletePayoutBy專案ID(專案ID);

  const rows: PayoutInsertRow[] = [];

  if (isPayoutModeB(專案類型)) {
    const 專案引薦人 = master.專案引薦人 ?? null;
    const rate引薦人 = parsePayoutRate(defaults.專案引薦人分潤成數);
    if (專案引薦人) {
      rows.push({
        專案ID,
        專案名稱,
        專案總金額未稅,
        專案營收,
        分潤類型: "專案引薦人",
        分潤成數: defaults.專案引薦人分潤成數 ?? null,
        分潤金額: String(Math.round(amount * rate引薦人)),
        領取人: 專案引薦人,
      });
    }
    const partners = await getPartners();
    const kol = master.KOL名稱?.trim()
      ? partners.find((p) => (p.合作夥伴名稱 ?? "").trim() === (master.KOL名稱 ?? "").trim())
      : null;
    const roles: Array<{ key: keyof PayoutDefaults; 分潤類型: string; 領取人: string | null }> = [
      { key: "經紀人分潤成數", 分潤類型: "經紀人", 領取人: kol?.經紀人 ?? null },
      { key: "主管分潤成數", 分潤類型: "主管", 領取人: kol?.主管 ?? null },
      { key: "KOL開發者分潤成數", 分潤類型: "KOL開發者", 領取人: kol?.KOL開發者 ?? null },
    ];
    for (const { key, 分潤類型, 領取人 } of roles) {
      if (!領取人) continue;
      const rate = parsePayoutRate(defaults[key]);
      rows.push({
        專案ID,
        專案名稱,
        專案總金額未稅,
        專案營收,
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
        分潤類型,
        分潤成數: rateStr ?? null,
        分潤金額: String(Math.round(amount * rate)),
        領取人,
      });
    }
  }

  const filteredRows = applyDedupeRules(rows, dedupeRules);
  if (filteredRows.length > 0) await insertPayoutRows(filteredRows);
}
