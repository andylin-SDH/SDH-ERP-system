/**
 * KOL 請款發票（一專案一列；發票號碼可跨專案重複）
 */

import { getSupabase } from "@/lib/supabase/server";
import { log } from "@/lib/log";

export interface KolInvoiceRow {
  id?: string;
  專案ID: string;
  KOL發票號碼?: string | null;
  KOL發票日期?: string | null;
  KOL發票備註?: string | null;
  填寫來源?: string | null;
  填寫人?: string | null;
  填寫時間?: string | null;
}

function rowToKolInvoice(r: Record<string, unknown>): KolInvoiceRow {
  const d = r.KOL發票日期 ?? r.kol_invoice_date;
  let dateStr: string | null = null;
  if (d != null && String(d).trim()) {
    dateStr = String(d).slice(0, 10);
  }
  return {
    id: r.id as string | undefined,
    專案ID: String(r.專案ID ?? r.project_id ?? ""),
    KOL發票號碼: (r.KOL發票號碼 ?? r.kol_invoice_number ?? null) as string | null,
    KOL發票日期: dateStr,
    KOL發票備註: (r.KOL發票備註 ?? r.kol_invoice_note ?? null) as string | null,
    填寫來源: (r.填寫來源 ?? r.filled_by_source ?? null) as string | null,
    填寫人: (r.填寫人 ?? r.filled_by ?? null) as string | null,
    填寫時間: (r.填寫時間 ?? r.filled_at ?? null) as string | null,
  };
}

export async function getKolInvoicesByProjectIds(projectIds: string[]): Promise<Map<string, KolInvoiceRow>> {
  const pids = [...new Set(projectIds.map((p) => String(p ?? "").trim()).filter(Boolean))];
  const out = new Map<string, KolInvoiceRow>();
  if (pids.length === 0) return out;

  const { data, error } = await getSupabase().from("KOL發票").select("*").in("專案ID", pids);
  if (error) {
    // Postgres 42P01；Supabase REST 常回 PGRST205（schema cache 找不到表）
    if (error.code === "42P01" || error.code === "PGRST205") {
      log("kol-invoices.db", "KOL發票表不存在", { code: error.code });
      return out;
    }
    throw error;
  }
  for (const row of data ?? []) {
    const rec = rowToKolInvoice(row as Record<string, unknown>);
    if (rec.專案ID) out.set(rec.專案ID, rec);
  }
  return out;
}

export async function getKolInvoiceByProjectId(專案ID: string): Promise<KolInvoiceRow | null> {
  const pid = String(專案ID ?? "").trim();
  if (!pid) return null;
  const map = await getKolInvoicesByProjectIds([pid]);
  return map.get(pid) ?? null;
}

export type UpsertKolInvoiceInput = {
  專案ID: string;
  KOL發票號碼?: string | null;
  KOL發票日期?: string | null;
  KOL發票備註?: string | null;
  填寫來源: "KOL" | "內部";
  填寫人: string;
};

export async function upsertKolInvoice(input: UpsertKolInvoiceInput): Promise<KolInvoiceRow> {
  const pid = String(input.專案ID ?? "").trim();
  if (!pid) throw new Error("專案ID 為必填");

  const now = new Date().toISOString();
  const numRaw = input.KOL發票號碼 !== undefined ? String(input.KOL發票號碼 ?? "").trim() : undefined;
  const noteRaw = input.KOL發票備註 !== undefined ? String(input.KOL發票備註 ?? "").trim() : undefined;
  const dateRaw = input.KOL發票日期 !== undefined ? String(input.KOL發票日期 ?? "").trim().slice(0, 10) : undefined;

  const payload: Record<string, unknown> = {
    專案ID: pid,
    填寫來源: input.填寫來源,
    填寫人: input.填寫人.trim(),
    填寫時間: now,
    updated_at: now,
  };
  if (numRaw !== undefined) payload.KOL發票號碼 = numRaw || null;
  if (noteRaw !== undefined) payload.KOL發票備註 = noteRaw || null;
  if (dateRaw !== undefined) {
    payload.KOL發票日期 = dateRaw && /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : null;
  }

  const { data, error } = await getSupabase()
    .from("KOL發票")
    .upsert(payload, { onConflict: "專案ID" })
    .select("*")
    .maybeSingle();

  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") {
      throw new Error("KOL發票表尚未建立，請先執行 migration 053_kol_invoices.sql");
    }
    throw error;
  }
  if (!data) throw new Error("儲存 KOL 發票失敗");
  return rowToKolInvoice(data as Record<string, unknown>);
}
