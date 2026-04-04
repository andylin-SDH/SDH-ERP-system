/**
 * Finance 資料層（Supabase）
 */

import { getSupabase } from "@/lib/supabase/server";
import type { FinanceRow, InvoiceRow } from "@/modules/finance/types";
import type { MasterRow } from "@/lib/db/master";
import { getMasterList } from "@/lib/db/master";

export async function syncFinanceForProject(master: MasterRow): Promise<void> {
  const 專案ID = String(master.專案ID ?? "").trim();
  if (!專案ID) return;

  const supabase = getSupabase();
  const payload = {
    專案總金額未稅: master.專案總金額未稅 ?? null,
    專案成本: master.專案成本 ?? null,
  };

  const { data: exists, error: qErr } = await supabase
    .from("財務")
    .select("id")
    .eq("專案ID", 專案ID)
    .limit(1);
  if (qErr) {
    if (qErr.code === "42P01") return;
    throw qErr;
  }

  if ((exists ?? []).length > 0) {
    const { error } = await supabase.from("財務").update(payload).eq("專案ID", 專案ID);
    if (error) throw error;
    return;
  }

  const { error } = await supabase.from("財務").insert({
    專案ID,
    ...payload,
  });
  if (error) throw error;
}

/** 刪除財務表中該專案列（與大總表刪除連動） */
export async function deleteFinanceBy專案ID(專案ID: string): Promise<void> {
  const pid = String(專案ID ?? "").trim();
  if (!pid) return;
  const { error } = await getSupabase().from("財務").delete().eq("專案ID", pid);
  if (error) {
    if (error.code === "42P01") return;
    throw error;
  }
}

export async function syncAllFinanceFromMaster(): Promise<void> {
  const masters = await getMasterList();
  for (const master of masters) {
    try {
      await syncFinanceForProject(master);
    } catch {
      // keep going: sync best effort
    }
  }
}

export async function getInvoices(): Promise<InvoiceRow[]> {
  const { data, error } = await getSupabase()
    .from("發票")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    if (error.code === "42P01") return []; // 表不存在時回傳空陣列，避免 500
    throw error;
  }
  return (data ?? []).map((r: Record<string, unknown>) => ({
    專案ID:
      r.專案ID != null && String(r.專案ID).trim() !== "" ? String(r.專案ID) : undefined,
    發票號碼: r.發票號碼 as string | undefined,
    發票日期: r.發票日期 as string | undefined,
    發票金額未稅: r.發票金額未稅 as string | undefined,
    發票金額含稅: r.發票金額含稅 as string | undefined,
    發票稅金: r.發票稅金 as string | undefined,
    廠商預計付款日: r.廠商預計付款日 as string | undefined,
    廠商實付金額: r.廠商實付金額 as string | undefined,
    廠商付款狀態: r.廠商付款狀態 as string | undefined,
    廠商付款日期: r.廠商付款日期 as string | undefined,
    備註: r.備註 as string | undefined,
  }));
}

export async function getFinance(): Promise<FinanceRow[]> {
  const { data, error } = await getSupabase().from("財務").select("*").order("created_at", { ascending: false });
  if (error) {
    if (error.code === "42P01") return []; // 表不存在時回傳空陣列，避免 500
    throw error;
  }
  return (data ?? []).map((r: Record<string, unknown>) => ({
    專案ID: r.專案ID as string | undefined,
    專案總金額未稅: r.專案總金額未稅 as string | undefined,
    專案成本: r.專案成本 as string | undefined,
    專案實際成本: r.專案實際成本 as string | undefined,
    專案分潤: r.專案分潤 as string | undefined,
    專案利潤: r.專案利潤 as string | undefined,
    專案利潤比: r.專案利潤比 as string | undefined,
    發票號碼: r.發票號碼 as string | undefined,
    廠商付款狀態: r.廠商付款狀態 as string | undefined,
    員工分潤狀態: r.員工分潤狀態 as string | undefined,
  }));
}

