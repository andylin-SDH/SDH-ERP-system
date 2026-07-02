/**
 * 專案收款連結與收款申報
 */

import { randomBytes } from "crypto";
import { getSupabase } from "@/lib/supabase/server";
import { getInvoices } from "@/lib/db/finance";
import { getMasterList } from "@/lib/db/master";
import { log } from "@/lib/log";
import { SDH_COLLECTION_BANK } from "@/lib/payment-collection/bank-info";
import type { PaymentFormPayload, PaymentLinkRow, PaymentSubmissionRow } from "@/lib/payment-collection/types";

function isMissingTableError(error: { code?: string; message?: string }): boolean {
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  const msg = String(error.message ?? "");
  return msg.includes("Could not find the table") || msg.includes("does not exist");
}

function rowToPaymentLink(r: Record<string, unknown>): PaymentLinkRow {
  return {
    id: String(r.id ?? ""),
    專案ID: String(r.專案ID ?? r.project_id ?? ""),
    token: String(r.token ?? ""),
    建立人: (r.建立人 ?? r.created_by ?? null) as string | null,
    created_at: r.created_at != null ? String(r.created_at) : undefined,
  };
}

function rowToSubmission(r: Record<string, unknown>): PaymentSubmissionRow {
  const d = r.匯款日期 ?? r.remit_date;
  return {
    id: String(r.id ?? ""),
    專案ID: String(r.專案ID ?? ""),
    連結ID: r.連結ID != null ? String(r.連結ID) : null,
    匯款單位: String(r.匯款單位 ?? ""),
    匯款日期: d != null ? String(d).slice(0, 10) : "",
    匯款金額: r.匯款金額 != null ? String(r.匯款金額) : null,
    匯款末五碼: String(r.匯款末五碼 ?? ""),
    匯款帳號: (r.匯款帳號 ?? null) as string | null,
    聯絡人: (r.聯絡人 ?? null) as string | null,
    聯絡Email: (r.聯絡Email ?? null) as string | null,
    聯絡電話: (r.聯絡電話 ?? null) as string | null,
    備註: (r.備註 ?? null) as string | null,
    submitted_at: r.submitted_at != null ? String(r.submitted_at) : undefined,
  };
}

function generateToken(): string {
  return randomBytes(24).toString("base64url");
}

export async function projectHasInvoices(專案ID: string): Promise<boolean> {
  const pid = String(專案ID ?? "").trim();
  if (!pid) return false;
  const invoices = await getInvoices();
  return invoices.some((inv) => String(inv.專案ID ?? "").trim() === pid);
}

export async function getPaymentLinkByProjectId(專案ID: string): Promise<PaymentLinkRow | null> {
  const pid = String(專案ID ?? "").trim();
  if (!pid) return null;
  const { data, error } = await getSupabase().from("專案收款連結").select("*").eq("專案ID", pid).maybeSingle();
  if (error) {
    if (isMissingTableError(error)) {
      log("payment-collection.db", "專案收款連結表不存在", { code: error.code });
      return null;
    }
    throw error;
  }
  if (!data) return null;
  return rowToPaymentLink(data as Record<string, unknown>);
}

export async function getPaymentLinkByToken(token: string): Promise<PaymentLinkRow | null> {
  const t = String(token ?? "").trim();
  if (!t) return null;
  const { data, error } = await getSupabase().from("專案收款連結").select("*").eq("token", t).maybeSingle();
  if (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
  if (!data) return null;
  return rowToPaymentLink(data as Record<string, unknown>);
}

export async function ensurePaymentLinkForProject(專案ID: string, 建立人: string): Promise<PaymentLinkRow> {
  const pid = String(專案ID ?? "").trim();
  if (!pid) throw new Error("專案ID 為必填");

  const hasInv = await projectHasInvoices(pid);
  if (!hasInv) throw new Error("此專案尚無關聯發票，請先在發票清冊將發票連結至本專案");

  const existing = await getPaymentLinkByProjectId(pid);
  if (existing) return existing;

  const now = new Date().toISOString();
  const payload = {
    專案ID: pid,
    token: generateToken(),
    建立人: 建立人.trim(),
    updated_at: now,
  };

  const { data, error } = await getSupabase().from("專案收款連結").insert(payload).select("*").single();
  if (error) {
    if (isMissingTableError(error)) {
      throw new Error("收款連結表尚未建立，請先執行 migration 054_payment_collection.sql");
    }
    if (error.code === "23505") {
      const again = await getPaymentLinkByProjectId(pid);
      if (again) return again;
    }
    throw error;
  }
  return rowToPaymentLink(data as Record<string, unknown>);
}

/** 重新產生 token（舊連結失效）；須已有發票 */
export async function regeneratePaymentLinkForProject(專案ID: string, 建立人: string): Promise<PaymentLinkRow> {
  const pid = String(專案ID ?? "").trim();
  if (!pid) throw new Error("專案ID 為必填");

  const hasInv = await projectHasInvoices(pid);
  if (!hasInv) throw new Error("此專案尚無關聯發票，請先在發票清冊將發票連結至本專案");

  const now = new Date().toISOString();
  const token = generateToken();
  const existing = await getPaymentLinkByProjectId(pid);

  if (existing) {
    const { data, error } = await getSupabase()
      .from("專案收款連結")
      .update({
        token,
        建立人: 建立人.trim(),
        updated_at: now,
      })
      .eq("專案ID", pid)
      .select("*")
      .single();
    if (error) {
      if (isMissingTableError(error)) {
        throw new Error("收款連結表尚未建立，請先執行 migration 054_payment_collection.sql");
      }
      throw error;
    }
    return rowToPaymentLink(data as Record<string, unknown>);
  }

  const { data, error } = await getSupabase()
    .from("專案收款連結")
    .insert({
      專案ID: pid,
      token,
      建立人: 建立人.trim(),
      updated_at: now,
    })
    .select("*")
    .single();
  if (error) throw error;
  return rowToPaymentLink(data as Record<string, unknown>);
}

export async function buildPaymentFormByToken(token: string): Promise<PaymentFormPayload | null> {
  const link = await getPaymentLinkByToken(token);
  if (!link) return null;

  const pid = link.專案ID;
  const masters = await getMasterList();
  const master = masters.find((m) => String(m.專案ID ?? "").trim() === pid);
  const invoices = (await getInvoices()).filter((inv) => String(inv.專案ID ?? "").trim() === pid);

  let total = 0;
  const invoiceRows = invoices.map((inv) => {
    const amt = parseFloat(String(inv.發票金額含稅 ?? "").replace(/,/g, "")) || 0;
    total += amt;
    return {
      發票號碼: String(inv.發票號碼 ?? "").trim() || "—",
      發票日期: String(inv.發票日期 ?? "").trim().slice(0, 10) || "—",
      收款對象: String(inv.收款對象 ?? "").trim() || "—",
      發票金額含稅: String(inv.發票金額含稅 ?? "").trim() || "—",
      廠商預計付款日: String(inv.廠商預計付款日 ?? "").trim().slice(0, 10) || "—",
    };
  });

  return {
    專案ID: pid,
    專案名稱: String(master?.專案名稱 ?? pid),
    invoices: invoiceRows,
    發票含稅合計: total > 0 ? Math.round(total).toLocaleString("zh-TW") : "—",
    bank: SDH_COLLECTION_BANK,
  };
}

export type SubmitPaymentInput = {
  token: string;
  匯款單位: string;
  匯款日期: string;
  匯款金額?: string | null;
  匯款末五碼: string;
  匯款帳號?: string | null;
  聯絡人?: string | null;
  聯絡Email?: string | null;
  聯絡電話?: string | null;
  備註?: string | null;
};

export async function submitPaymentDeclaration(input: SubmitPaymentInput): Promise<PaymentSubmissionRow> {
  const link = await getPaymentLinkByToken(input.token);
  if (!link) throw new Error("連結無效或已失效");

  const 匯款單位 = String(input.匯款單位 ?? "").trim();
  const 匯款日期 = String(input.匯款日期 ?? "").trim().slice(0, 10);
  const 匯款末五碼 = String(input.匯款末五碼 ?? "").trim();
  if (!匯款單位) throw new Error("請填寫匯款單位");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(匯款日期)) throw new Error("請填寫有效的匯款日期");
  if (!/^\d{5}$/.test(匯款末五碼)) throw new Error("匯款末五碼須為 5 位數字");

  const amtRaw = String(input.匯款金額 ?? "").trim().replace(/,/g, "");
  const 匯款金額 = amtRaw ? parseFloat(amtRaw) : null;
  if (amtRaw && (匯款金額 == null || Number.isNaN(匯款金額))) {
    throw new Error("匯款金額格式不正確");
  }

  const payload: Record<string, unknown> = {
    專案ID: link.專案ID,
    連結ID: link.id,
    匯款單位,
    匯款日期,
    匯款金額,
    匯款末五碼,
    匯款帳號: String(input.匯款帳號 ?? "").trim() || null,
    聯絡人: String(input.聯絡人 ?? "").trim() || null,
    聯絡Email: String(input.聯絡Email ?? "").trim() || null,
    聯絡電話: String(input.聯絡電話 ?? "").trim() || null,
    備註: String(input.備註 ?? "").trim() || null,
    submitted_at: new Date().toISOString(),
  };

  const { data, error } = await getSupabase().from("收款申報").insert(payload).select("*").single();
  if (error) {
    if (isMissingTableError(error)) {
      throw new Error("收款申報表尚未建立，請先執行 migration 054_payment_collection.sql");
    }
    throw error;
  }
  return rowToSubmission(data as Record<string, unknown>);
}

export async function getSubmissionsByProjectId(專案ID: string): Promise<PaymentSubmissionRow[]> {
  const pid = String(專案ID ?? "").trim();
  if (!pid) return [];
  const { data, error } = await getSupabase()
    .from("收款申報")
    .select("*")
    .eq("專案ID", pid)
    .order("submitted_at", { ascending: false });
  if (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
  return (data ?? []).map((r) => rowToSubmission(r as Record<string, unknown>));
}

export type PaymentSubmissionWithProject = PaymentSubmissionRow & {
  專案名稱: string;
};

/** 全部收款申報（財務清單用，新到舊） */
export async function getAllPaymentSubmissions(): Promise<PaymentSubmissionWithProject[]> {
  const { data, error } = await getSupabase()
    .from("收款申報")
    .select("*")
    .order("submitted_at", { ascending: false });
  if (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
  const rows = (data ?? []).map((r) => rowToSubmission(r as Record<string, unknown>));
  if (rows.length === 0) return [];

  const masters = await getMasterList();
  const nameByPid = new Map<string, string>();
  for (const m of masters) {
    const pid = String(m.專案ID ?? "").trim();
    if (pid) nameByPid.set(pid, String(m.專案名稱 ?? "").trim() || pid);
  }

  return rows.map((r) => ({
    ...r,
    專案名稱: nameByPid.get(r.專案ID) ?? r.專案ID,
  }));
}
