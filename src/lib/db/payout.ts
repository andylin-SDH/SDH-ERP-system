/**
 * 分潤表 資料層（Supabase）
 * 表名：分潤表
 */

import { getSupabase } from "@/lib/supabase/server";
import { log } from "@/lib/log";

export interface PayoutRow {
  id?: string;
  專案ID?: string;
  專案名稱?: string;
  專案總金額未稅?: string;
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
    分潤類型: (r.分潤類型 ?? r.payout_type) as string | undefined,
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

  return (data ?? []).map((r) => rowToPayout(r as Record<string, unknown>));
}
