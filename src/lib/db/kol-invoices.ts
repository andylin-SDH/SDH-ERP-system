/**
 * KOL 請款憑證（一專案一列；發票或勞務報酬）
 */

import { getSupabase } from "@/lib/supabase/server";
import { log } from "@/lib/log";
import { kolHasRequestCredential, kolRequestMode, type KolRequestCredential } from "@/lib/kol/finance-status";
import { calcLaborWithholding, type LaborPaymentMethod } from "@/lib/kol/labor-receipt";

export interface KolInvoiceRow extends KolRequestCredential {
  id?: string;
  專案ID: string;
  KOL發票日期?: string | null;
  KOL發票備註?: string | null;
  KOL匯款日期?: string | null;
  KOL匯款金額?: string | null;
  填寫來源?: string | null;
  填寫人?: string | null;
  填寫時間?: string | null;
}

function sliceDate(raw: unknown): string | null {
  if (raw == null || !String(raw).trim()) return null;
  return String(raw).slice(0, 10);
}

function isKolInvoiceTableMissing(error: { code?: string | null; message?: string | null }): boolean {
  const code = String(error.code ?? "");
  if (code === "42P01" || code === "PGRST205") return true;
  const msg = String(error.message ?? "");
  return msg.includes("KOL發票") && (msg.includes("schema cache") || msg.includes("does not exist"));
}

function rowToKolInvoice(r: Record<string, unknown>): KolInvoiceRow {
  return {
    id: r.id as string | undefined,
    專案ID: String(r.專案ID ?? r.project_id ?? ""),
    請款方式: (r.請款方式 ?? null) as string | null,
    KOL發票號碼: (r.KOL發票號碼 ?? r.kol_invoice_number ?? null) as string | null,
    KOL發票日期: sliceDate(r.KOL發票日期 ?? r.kol_invoice_date),
    KOL發票備註: (r.KOL發票備註 ?? r.kol_invoice_note ?? null) as string | null,
    勞務期間起: sliceDate(r.勞務期間起),
    勞務期間迄: sliceDate(r.勞務期間迄),
    勞務內容: (r.勞務內容 ?? null) as string | null,
    給付總額: (r.給付總額 ?? null) as string | null,
    身分證字號: (r.身分證字號 ?? null) as string | null,
    領款方式: (r.領款方式 ?? null) as string | null,
    聯絡電話: (r.聯絡電話 ?? null) as string | null,
    戶籍地址: (r.戶籍地址 ?? null) as string | null,
    扣繳稅額: (r.扣繳稅額 ?? null) as string | null,
    二代健保費: (r.二代健保費 ?? null) as string | null,
    實領金額: (r.實領金額 ?? null) as string | null,
    勞報簽署時間: (r.勞報簽署時間 ?? null) as string | null,
    勞報簽名: (r.勞報簽名 ?? null) as string | null,
    KOL匯款日期: sliceDate(r.KOL匯款日期 ?? r.kol_remittance_date),
    KOL匯款金額: (r.KOL匯款金額 ?? r.kol_remittance_amount ?? null) as string | null,
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
    if (isKolInvoiceTableMissing(error)) {
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

export async function getAllKolInvoices(): Promise<KolInvoiceRow[]> {
  const { data, error } = await getSupabase().from("KOL發票").select("*");
  if (error) {
    if (isKolInvoiceTableMissing(error)) {
      log("kol-invoices.db", "KOL發票表不存在", { code: error.code });
      return [];
    }
    throw error;
  }
  return (data ?? []).map((row) => rowToKolInvoice(row as Record<string, unknown>));
}

export async function setKolRemittance(
  專案ID: string,
  input: { KOL匯款日期: string; KOL匯款金額?: string | null }
): Promise<KolInvoiceRow> {
  const pid = String(專案ID ?? "").trim();
  const date = String(input.KOL匯款日期 ?? "").trim().slice(0, 10);
  if (!pid) throw new Error("專案ID 為必填");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("請填寫有效的匯款日期");

  const existing = await getKolInvoiceByProjectId(pid);
  if (!existing) throw new Error("此專案尚無請款憑證，無法登記匯款");
  if (String(existing.KOL匯款日期 ?? "").trim()) {
    throw new Error("此專案已登記 KOL 匯款，不可重複登記");
  }
  if (!kolHasRequestCredential(existing)) {
    throw new Error("此專案請款憑證尚未完成（發票或勞務報酬單）");
  }

  const amtRaw = String(input.KOL匯款金額 ?? "").trim().replace(/,/g, "");
  const now = new Date().toISOString();
  const payload: Record<string, unknown> = {
    KOL匯款日期: date,
    KOL匯款金額: amtRaw || null,
    updated_at: now,
  };

  const { data, error } = await getSupabase()
    .from("KOL發票")
    .update(payload)
    .eq("專案ID", pid)
    .select("*")
    .maybeSingle();

  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") {
      throw new Error("KOL發票表尚未建立，請先執行 migration");
    }
    throw error;
  }
  if (!data) throw new Error("找不到該專案請款憑證或更新失敗");
  return rowToKolInvoice(data as Record<string, unknown>);
}

/** 已登記匯款後，修正 KOL 匯款日期（例如由付款記錄「付款日期」連動） */
export async function updateKolRemittanceDate(專案ID: string, 匯款日期: string): Promise<KolInvoiceRow> {
  const pid = String(專案ID ?? "").trim();
  const date = String(匯款日期 ?? "").trim().slice(0, 10);
  if (!pid) throw new Error("專案ID 為必填");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("請填寫有效的匯款日期");

  const existing = await getKolInvoiceByProjectId(pid);
  if (!existing) throw new Error("此專案尚無請款憑證，無法更新匯款日期");
  if (!String(existing.KOL匯款日期 ?? "").trim()) {
    throw new Error("此專案尚未登記匯款，請先至 KOL 匯款登記");
  }
  if (String(existing.KOL匯款日期 ?? "").trim().slice(0, 10) === date) {
    return existing;
  }

  const { data, error } = await getSupabase()
    .from("KOL發票")
    .update({ KOL匯款日期: date, updated_at: new Date().toISOString() })
    .eq("專案ID", pid)
    .select("*")
    .maybeSingle();

  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") {
      throw new Error("KOL發票表尚未建立，請先執行 migration");
    }
    throw error;
  }
  if (!data) throw new Error("找不到該專案請款憑證或更新失敗");
  return rowToKolInvoice(data as Record<string, unknown>);
}

export async function getKolInvoiceByProjectId(專案ID: string): Promise<KolInvoiceRow | null> {
  const pid = String(專案ID ?? "").trim();
  if (!pid) return null;
  const map = await getKolInvoicesByProjectIds([pid]);
  return map.get(pid) ?? null;
}

export type UpsertKolInvoiceInput = {
  專案ID: string;
  請款方式?: "發票" | "勞務報酬" | null;
  KOL發票號碼?: string | null;
  KOL發票日期?: string | null;
  KOL發票備註?: string | null;
  勞務期間起?: string | null;
  勞務期間迄?: string | null;
  勞務內容?: string | null;
  給付總額?: string | null;
  身分證字號?: string | null;
  領款方式?: LaborPaymentMethod | null;
  聯絡電話?: string | null;
  戶籍地址?: string | null;
  /** 勞務報酬：KOL 勾選確認並送出 */
  勞報簽署?: boolean;
  勞報簽名?: string | null;
  填寫來源: "KOL" | "內部";
  填寫人: string;
};

function normalizeIdNumber(raw: string): string {
  return raw.trim().toUpperCase();
}

export async function upsertKolInvoice(input: UpsertKolInvoiceInput): Promise<KolInvoiceRow> {
  const pid = String(input.專案ID ?? "").trim();
  if (!pid) throw new Error("專案ID 為必填");

  const mode =
    input.請款方式 === "勞務報酬" || input.請款方式 === "發票"
      ? input.請款方式
      : input.勞報簽署 || input.勞務內容 !== undefined
        ? "勞務報酬"
        : "發票";

  const now = new Date().toISOString();
  const payload: Record<string, unknown> = {
    專案ID: pid,
    請款方式: mode,
    填寫來源: input.填寫來源,
    填寫人: input.填寫人.trim(),
    填寫時間: now,
    updated_at: now,
  };

  if (mode === "發票") {
    const numRaw = input.KOL發票號碼 !== undefined ? String(input.KOL發票號碼 ?? "").trim() : undefined;
    const noteRaw = input.KOL發票備註 !== undefined ? String(input.KOL發票備註 ?? "").trim() : undefined;
    const dateRaw = input.KOL發票日期 !== undefined ? String(input.KOL發票日期 ?? "").trim().slice(0, 10) : undefined;
    if (numRaw !== undefined) payload.KOL發票號碼 = numRaw || null;
    if (noteRaw !== undefined) payload.KOL發票備註 = noteRaw || null;
    if (dateRaw !== undefined) {
      payload.KOL發票日期 = dateRaw && /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : null;
    }
    payload.勞務期間起 = null;
    payload.勞務期間迄 = null;
    payload.勞務內容 = null;
    payload.給付總額 = null;
    payload.身分證字號 = null;
    payload.領款方式 = null;
    payload.聯絡電話 = null;
    payload.戶籍地址 = null;
    payload.扣繳稅額 = null;
    payload.二代健保費 = null;
    payload.實領金額 = null;
    payload.勞報簽署時間 = null;
    payload.勞報簽名 = null;
  } else {
    const start = String(input.勞務期間起 ?? "").trim().slice(0, 10);
    const end = String(input.勞務期間迄 ?? "").trim().slice(0, 10);
    const content = String(input.勞務內容 ?? "").trim();
    const amount = String(input.給付總額 ?? "").trim().replace(/,/g, "");
    const idNo = normalizeIdNumber(String(input.身分證字號 ?? ""));
    const phone = String(input.聯絡電話 ?? "").trim();
    const address = String(input.戶籍地址 ?? "").trim();
    const payMethod: LaborPaymentMethod = input.領款方式 === "匯款" ? "匯款" : "現金";

    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) throw new Error("請填寫有效的勞務期間（起）");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) throw new Error("請填寫有效的勞務期間（迄）");
    if (!content) throw new Error("請填寫勞務內容");
    if (!amount) throw new Error("請填寫給付總額");
    if (!/^[A-Z][12]\d{8}$/.test(idNo)) throw new Error("請填寫有效的身分證字號");
    if (!phone) throw new Error("請填寫聯絡電話");
    if (!address) throw new Error("請填寫戶籍地址");
    if (!input.勞報簽署) throw new Error("請勾選確認勞務報酬單內容正確");
    const signature = String(input.勞報簽名 ?? "").trim();
    if (!signature.startsWith("data:image/png")) throw new Error("請在簽名板完成電子簽名");

    const w = calcLaborWithholding(amount);

    payload.勞務期間起 = start;
    payload.勞務期間迄 = end;
    payload.勞務內容 = content;
    payload.給付總額 = String(w.應領金額);
    payload.身分證字號 = idNo;
    payload.領款方式 = payMethod;
    payload.聯絡電話 = phone;
    payload.戶籍地址 = address;
    payload.扣繳稅額 = String(w.扣繳稅額);
    payload.二代健保費 = String(w.二代健保費);
    payload.實領金額 = String(w.實領金額);
    payload.勞報簽署時間 = now;
    payload.勞報簽名 = signature;
    payload.KOL發票號碼 = null;
    payload.KOL發票日期 = null;
    payload.KOL發票備註 = String(input.KOL發票備註 ?? "").trim() || null;
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
  if (!data) throw new Error("儲存請款憑證失敗");
  return rowToKolInvoice(data as Record<string, unknown>);
}
