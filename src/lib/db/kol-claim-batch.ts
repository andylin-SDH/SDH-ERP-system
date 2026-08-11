/**
 * KOL 批次請款：寫入批次／項目／勞報單據，並 upsert 各專案 KOL發票
 */

import { getSupabase } from "@/lib/supabase/server";
import { log } from "@/lib/log";
import { upsertKolInvoice, type KolInvoiceRow } from "@/lib/db/kol-invoices";
import {
  buildLaborClaimSplit,
  type ClaimProjectAmount,
  type ClaimSplitResult,
} from "@/lib/kol/claim-split";
import type { LaborPaymentMethod } from "@/lib/kol/labor-receipt";

export type CreateKolClaimBatchInput = {
  partnerId: string;
  projects: ClaimProjectAmount[];
  請款方式: "發票" | "勞務報酬";
  KOL發票號碼?: string | null;
  KOL發票日期?: string | null;
  KOL發票金額?: string | null;
  KOL發票備註?: string | null;
  勞務期間起?: string | null;
  勞務期間迄?: string | null;
  勞務內容?: string | null;
  身分證字號?: string | null;
  領款方式?: LaborPaymentMethod | null;
  聯絡電話?: string | null;
  戶籍地址?: string | null;
  勞報簽署?: boolean;
  勞報簽名?: string | null;
  填寫人: string;
  填寫來源?: "KOL" | "內部";
};

export type CreateKolClaimBatchResult = {
  batchId: string;
  updated: KolInvoiceRow[];
  split: ClaimSplitResult | null;
};

function isMissingTableError(error: { code?: string | null; message?: string | null }): boolean {
  const code = String(error.code ?? "");
  if (code === "42P01" || code === "PGRST205") return true;
  const msg = String(error.message ?? "");
  return msg.includes("schema cache") || msg.includes("does not exist");
}

export async function createKolClaimBatch(input: CreateKolClaimBatchInput): Promise<CreateKolClaimBatchResult> {
  const partnerId = String(input.partnerId ?? "").trim();
  if (!partnerId) throw new Error("缺少 PartnerID");

  const projects = input.projects
    .map((p) => ({
      專案ID: String(p.專案ID ?? "").trim(),
      金額: Math.round(Number(p.金額) || 0),
      專案名稱: String(p.專案名稱 ?? "").trim() || undefined,
    }))
    .filter((p) => p.專案ID && p.金額 > 0);

  if (projects.length === 0) throw new Error("請至少選擇一筆可請款專案");

  const total = projects.reduce((a, p) => a + p.金額, 0);
  const mode = input.請款方式;
  const 填寫來源 = input.填寫來源 ?? "KOL";
  const 填寫人 = String(input.填寫人 ?? "").trim();
  if (!填寫人) throw new Error("缺少填寫人");

  let split: ClaimSplitResult | null = null;
  if (mode === "勞務報酬") {
    split = buildLaborClaimSplit(projects);
    if (split.slips.length === 0) throw new Error("勞報拆單失敗：合計為 0");
  } else {
    const num = String(input.KOL發票號碼 ?? "").trim();
    if (!num) throw new Error("請填寫發票號碼");
    const amt = String(input.KOL發票金額 ?? "").trim().replace(/,/g, "");
    if (!amt) throw new Error("請填寫發票金額");
    if (!(Number(amt) > 0)) throw new Error("發票金額必須大於 0");
  }

  const now = new Date().toISOString();
  const batchPayload: Record<string, unknown> = {
    PartnerID: partnerId,
    請款方式: mode,
    合計金額: total,
    單據張數: split?.slips.length ?? 0,
    填寫人,
    填寫來源,
    created_at: now,
    updated_at: now,
  };

  if (mode === "發票") {
    const dateRaw = String(input.KOL發票日期 ?? "").trim().slice(0, 10);
    batchPayload.KOL發票號碼 = String(input.KOL發票號碼 ?? "").trim();
    batchPayload.KOL發票日期 = dateRaw && /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : null;
    batchPayload.KOL發票金額 = String(input.KOL發票金額 ?? "").trim().replace(/,/g, "") || null;
    batchPayload.KOL發票備註 = String(input.KOL發票備註 ?? "").trim() || null;
  } else {
    const start = String(input.勞務期間起 ?? "").trim().slice(0, 10);
    const end = String(input.勞務期間迄 ?? "").trim().slice(0, 10);
    const content = String(input.勞務內容 ?? "").trim();
    const idNo = String(input.身分證字號 ?? "").trim().toUpperCase();
    const phone = String(input.聯絡電話 ?? "").trim();
    const address = String(input.戶籍地址 ?? "").trim();
    const signature = String(input.勞報簽名 ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) throw new Error("請填寫有效的勞務期間（起）");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) throw new Error("請填寫有效的勞務期間（迄）");
    if (!content) throw new Error("請填寫勞務內容");
    if (!/^[A-Z][12]\d{8}$/.test(idNo)) throw new Error("請填寫有效的身分證字號");
    if (!phone) throw new Error("請填寫聯絡電話");
    if (!address) throw new Error("請填寫戶籍地址");
    if (!input.勞報簽署) throw new Error("請勾選確認勞務報酬單內容正確");
    if (!signature.startsWith("data:image/png")) throw new Error("請在簽名板完成電子簽名");

    batchPayload.勞務期間起 = start;
    batchPayload.勞務期間迄 = end;
    batchPayload.勞務內容 = content;
    batchPayload.身分證字號 = idNo;
    batchPayload.領款方式 = input.領款方式 === "匯款" ? "匯款" : "現金";
    batchPayload.聯絡電話 = phone;
    batchPayload.戶籍地址 = address;
    batchPayload.勞報簽名 = signature;
    batchPayload.勞報簽署時間 = now;
    batchPayload.KOL發票備註 = String(input.KOL發票備註 ?? "").trim() || null;
  }

  const sb = getSupabase();
  const { data: batchRow, error: batchErr } = await sb
    .from("KOL請款批次")
    .insert(batchPayload)
    .select("id")
    .maybeSingle();

  if (batchErr) {
    if (isMissingTableError(batchErr)) {
      throw new Error("請款批次表尚未建立，請先執行 migration 062_kol_claim_batch.sql");
    }
    throw batchErr;
  }
  const batchId = String((batchRow as { id?: string } | null)?.id ?? "").trim();
  if (!batchId) throw new Error("建立請款批次失敗");

  const itemRows = projects.map((p) => ({
    批次ID: batchId,
    專案ID: p.專案ID,
    金額快照: p.金額,
    專案名稱: p.專案名稱 ?? null,
  }));
  const { error: itemErr } = await sb.from("KOL請款批次項目").insert(itemRows);
  if (itemErr) {
    log("kol-claim-batch", "寫入批次項目失敗", { batchId, error: itemErr.message });
    throw itemErr;
  }

  if (split) {
    const slipIdBySeq = new Map<number, string>();
    for (const slip of split.slips) {
      const { data: slipRow, error: slipErr } = await sb
        .from("KOL勞報單據")
        .insert({
          批次ID: batchId,
          序號: slip.序號,
          給付總額: slip.給付總額,
        })
        .select("id")
        .maybeSingle();
      if (slipErr) throw slipErr;
      const sid = String((slipRow as { id?: string } | null)?.id ?? "").trim();
      if (!sid) throw new Error(`建立勞報單據 #${slip.序號} 失敗`);
      slipIdBySeq.set(slip.序號, sid);
    }

    const allocRows = split.allocations.map((a) => {
      const sid = slipIdBySeq.get(a.序號);
      if (!sid) throw new Error(`找不到單據 #${a.序號}`);
      return {
        單據ID: sid,
        批次ID: batchId,
        專案ID: a.專案ID,
        分配金額: a.分配金額,
      };
    });
    if (allocRows.length > 0) {
      const { error: allocErr } = await sb.from("KOL勞報單據分配").insert(allocRows);
      if (allocErr) throw allocErr;
    }
  }

  const updated: KolInvoiceRow[] = [];
  for (const p of projects) {
    if (mode === "發票") {
      updated.push(
        await upsertKolInvoice({
          專案ID: p.專案ID,
          請款方式: "發票",
          KOL發票號碼: input.KOL發票號碼,
          KOL發票日期: input.KOL發票日期,
          KOL發票金額: input.KOL發票金額,
          KOL發票備註: input.KOL發票備註,
          請款批次ID: batchId,
          填寫來源,
          填寫人,
        })
      );
    } else {
      updated.push(
        await upsertKolInvoice({
          專案ID: p.專案ID,
          請款方式: "勞務報酬",
          勞務期間起: input.勞務期間起,
          勞務期間迄: input.勞務期間迄,
          勞務內容: input.勞務內容,
          給付總額: String(p.金額),
          身分證字號: input.身分證字號,
          領款方式: input.領款方式 ?? "現金",
          聯絡電話: input.聯絡電話,
          戶籍地址: input.戶籍地址,
          KOL發票備註: input.KOL發票備註,
          勞報簽署: true,
          勞報簽名: input.勞報簽名,
          請款批次ID: batchId,
          skipLaborWithholding: true,
          填寫來源,
          填寫人,
        })
      );
    }
  }

  return { batchId, updated, split };
}

export async function getKolClaimBatchSummary(batchId: string): Promise<{
  id: string;
  請款方式: string;
  KOL發票號碼: string;
  單據張數: number;
  合計金額: number;
} | null> {
  const id = String(batchId ?? "").trim();
  if (!id) return null;
  const { data, error } = await getSupabase()
    .from("KOL請款批次")
    .select('id,"請款方式","KOL發票號碼","單據張數","合計金額"')
    .eq("id", id)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
  if (!data) return null;
  const row = data as Record<string, unknown>;
  return {
    id: String(row.id ?? ""),
    請款方式: String(row.請款方式 ?? ""),
    KOL發票號碼: String(row.KOL發票號碼 ?? "").trim(),
    單據張數: Number(row.單據張數) || 0,
    合計金額: Number(row.合計金額) || 0,
  };
}
