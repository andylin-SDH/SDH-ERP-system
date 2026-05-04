/**
 * Finance 資料層（Supabase）
 */

import { getSupabase } from "@/lib/supabase/server";
import type { FinanceRow, InvoiceRow, PaymentRecordRow } from "@/modules/finance/types";
import { normalizeDecimalString } from "@/lib/number-normalize";

function normalizeMoneyString(raw: unknown): string | undefined {
  return normalizeDecimalString(raw, 2);
}

/** 新增發票（單筆／批次共用欄位） */
export type InvoiceInsertInput = {
  專案ID?: string | null;
  發票號碼?: string | null;
  發票日期?: string | null;
  發票金額未稅?: string | null;
  發票金額含稅?: string | null;
  發票稅金?: string | null;
  廠商預計付款日?: string | null;
  廠商實付金額?: string | null;
  廠商付款狀態?: string | null;
  廠商付款日期?: string | null;
  備註?: string | null;
};

/** 付款記錄（單筆／批次共用欄位） */
export type PaymentRecordInput = {
  發票號碼?: string | null;
  付款日期?: string | null;
  付款專案?: string | null;
  付款對象?: string | null;
  付款金額?: string | null;
  備註?: string | null;
};

function mapInvoiceRecord(r: Record<string, unknown>): InvoiceRow {
  return {
    id: r.id != null ? String(r.id) : undefined,
    專案ID:
      r.專案ID != null && String(r.專案ID).trim() !== "" ? String(r.專案ID) : undefined,
    發票號碼: r.發票號碼 != null ? String(r.發票號碼) : undefined,
    發票日期: r.發票日期 != null ? String(r.發票日期) : undefined,
    發票金額未稅: normalizeMoneyString(r.發票金額未稅),
    發票金額含稅: normalizeMoneyString(r.發票金額含稅),
    發票稅金: normalizeMoneyString(r.發票稅金),
    廠商預計付款日: r.廠商預計付款日 != null ? String(r.廠商預計付款日) : undefined,
    廠商實付金額: normalizeMoneyString(r.廠商實付金額),
    廠商付款狀態: r.廠商付款狀態 != null ? String(r.廠商付款狀態) : undefined,
    廠商付款日期: r.廠商付款日期 != null ? String(r.廠商付款日期) : undefined,
    備註: r.備註 != null ? String(r.備註) : undefined,
  };
}

function mapPaymentRecord(r: Record<string, unknown>): PaymentRecordRow {
  return {
    id: r.id != null ? String(r.id) : undefined,
    發票號碼: r.發票號碼 != null ? String(r.發票號碼) : undefined,
    付款日期: r.付款日期 != null ? String(r.付款日期) : undefined,
    付款專案: r.付款專案 != null ? String(r.付款專案) : undefined,
    付款對象: r.付款對象 != null ? String(r.付款對象) : undefined,
    付款金額: normalizeMoneyString(r.付款金額),
    備註: r.備註 != null ? String(r.備註) : undefined,
  };
}
import type { MasterRow } from "@/lib/db/master";
import { getMasterList } from "@/lib/db/master";

export async function syncFinanceForProject(master: MasterRow): Promise<void> {
  const 專案ID = String(master.專案ID ?? "").trim();
  if (!專案ID) return;

  const supabase = getSupabase();
  const payload = {
    專案總金額未稅: master.專案總金額未稅 ?? null,
    專案成本: master.專案成本 ?? null,
    廠商預計付款日: master.廠商預計付款日 ?? null,
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

/** 財務「依專案」僅允許 PATCH 此二欄；其餘由大總表同步帶入 */
export type FinanceUpdateFields = {
  廠商付款日期?: string | null;
  員工分潤日期?: string | null;
};

function mapFinanceDbRow(r: Record<string, unknown>, 專案名稱: string | undefined): FinanceRow {
  return {
    專案ID: r.專案ID != null ? String(r.專案ID) : undefined,
    專案名稱,
    專案總金額未稅: normalizeMoneyString(r.專案總金額未稅),
    專案成本: normalizeMoneyString(r.專案成本),
    專案實際成本: normalizeMoneyString(r.專案實際成本),
    專案分潤: normalizeMoneyString(r.專案分潤),
    專案利潤: normalizeMoneyString(r.專案利潤),
    專案利潤比: normalizeMoneyString(r.專案利潤比),
    發票號碼: r.發票號碼 != null ? String(r.發票號碼) : undefined,
    廠商預計付款日: r.廠商預計付款日 != null ? String(r.廠商預計付款日) : undefined,
    廠商付款日期:
      r.廠商付款日期 != null
        ? String(r.廠商付款日期)
        : r.廠商付款狀態 != null
          ? String(r.廠商付款狀態)
          : undefined,
    員工分潤日期:
      r.員工分潤日期 != null
        ? String(r.員工分潤日期)
        : r.員工分潤狀態 != null
          ? String(r.員工分潤狀態)
          : undefined,
  };
}

/**
 * 財務寫入廠商／員工日期後，將同專案所有分潤表列的「廠商付款日期」「分潤匯款日期」與財務對齊。
 * （語意：廠商付款日期 ↔ 財務；員工分潤日 → 分潤已匯出）
 */
async function syncPayoutRowsFromFinanceDates(
  專案ID: string,
  廠商付款日期Val: string | undefined,
  員工分潤日期Val: string | undefined
): Promise<void> {
  const pid = String(專案ID ?? "").trim();
  if (!pid) return;
  const vIn =
    廠商付款日期Val == null || String(廠商付款日期Val).trim() === "" ? null : String(廠商付款日期Val).trim();
  const pOut =
    員工分潤日期Val == null || String(員工分潤日期Val).trim() === "" ? null : String(員工分潤日期Val).trim();
  const { error } = await getSupabase()
    .from("分潤表")
    .update({ 廠商付款日期: vIn, 分潤匯款日期: pOut })
    .eq("專案ID", pid);
  if (error) {
    if (error.code === "42P01") return;
    throw error;
  }
}

/**
 * 依專案ID 更新財務列（僅廠商付款日期、員工分潤日期）。migration 需已將欄位更名。
 * 成功後會同步更新該專案所有分潤表列之廠商付款日期／分潤匯款日。
 */
export async function updateFinanceBy專案ID(專案ID: string, row: FinanceUpdateFields): Promise<FinanceRow> {
  const pid = String(專案ID ?? "").trim();
  if (!pid) throw new Error("缺少專案ID");

  const payload = {
    廠商付款日期: trimOrNull(row.廠商付款日期),
    員工分潤日期: trimOrNull(row.員工分潤日期),
  };

  const { data, error } = await getSupabase().from("財務").update(payload).eq("專案ID", pid).select("*").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("找不到該專案之財務列或更新失敗");
  const updated = mapFinanceDbRow(data as Record<string, unknown>, undefined);
  await syncPayoutRowsFromFinanceDates(pid, updated.廠商付款日期, updated.員工分潤日期);
  return updated;
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
  return (data ?? []).map((r: Record<string, unknown>) => mapInvoiceRecord(r));
}

function trimOrNull(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}

function normalizeMoneyOrNull(v: string | null | undefined): string | null {
  if (v == null) return null;
  const normalized = normalizeMoneyString(v);
  if (normalized == null) return null;
  const t = String(normalized).trim();
  return t === "" ? null : t;
}

/**
 * 批次新增發票（至少一筆須填發票號碼；專案ID 可空）
 */
export async function createInvoicesBatch(rows: InvoiceInsertInput[]): Promise<InvoiceRow[]> {
  const payload = rows
    .map((row) => ({
      專案ID: trimOrNull(row.專案ID ?? undefined),
      發票號碼: trimOrNull(row.發票號碼 ?? undefined),
      發票日期: trimOrNull(row.發票日期 ?? undefined),
      發票金額未稅: normalizeMoneyOrNull(row.發票金額未稅 ?? undefined),
      發票金額含稅: normalizeMoneyOrNull(row.發票金額含稅 ?? undefined),
      發票稅金: normalizeMoneyOrNull(row.發票稅金 ?? undefined),
      廠商預計付款日: trimOrNull(row.廠商預計付款日 ?? undefined),
      廠商實付金額: normalizeMoneyOrNull(row.廠商實付金額 ?? undefined),
      廠商付款狀態: trimOrNull(row.廠商付款狀態 ?? undefined),
      廠商付款日期: trimOrNull(row.廠商付款日期 ?? undefined),
      備註: trimOrNull(row.備註 ?? undefined),
    }))
    .filter((r) => r.發票號碼 != null);

  if (payload.length === 0) {
    throw new Error("請至少填寫一筆發票號碼");
  }

  const { data, error } = await getSupabase().from("發票").insert(payload).select("*");
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => mapInvoiceRecord(r));
}

/**
 * 更新發票（依 id）。須提供完整可編輯欄位；發票號碼不可空白。
 */
export async function updateInvoiceById(id: string, row: InvoiceInsertInput): Promise<InvoiceRow> {
  const pid = String(id ?? "").trim();
  if (!pid) throw new Error("缺少發票 id");

  const 發票號碼 = trimOrNull(row.發票號碼 ?? undefined);
  if (發票號碼 == null) throw new Error("發票號碼不可空白");

  const payload = {
    專案ID: trimOrNull(row.專案ID ?? undefined),
    發票號碼,
    發票日期: trimOrNull(row.發票日期 ?? undefined),
    發票金額未稅: normalizeMoneyOrNull(row.發票金額未稅 ?? undefined),
    發票金額含稅: normalizeMoneyOrNull(row.發票金額含稅 ?? undefined),
    發票稅金: normalizeMoneyOrNull(row.發票稅金 ?? undefined),
    廠商預計付款日: trimOrNull(row.廠商預計付款日 ?? undefined),
    廠商實付金額: normalizeMoneyOrNull(row.廠商實付金額 ?? undefined),
    廠商付款狀態: trimOrNull(row.廠商付款狀態 ?? undefined),
    廠商付款日期: trimOrNull(row.廠商付款日期 ?? undefined),
    備註: trimOrNull(row.備註 ?? undefined),
  };

  const { data, error } = await getSupabase().from("發票").update(payload).eq("id", pid).select("*").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("找不到該發票或更新失敗");
  return mapInvoiceRecord(data as Record<string, unknown>);
}

export async function getPaymentRecords(): Promise<PaymentRecordRow[]> {
  const { data, error } = await getSupabase()
    .from("付款記錄")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    if (error.code === "42P01") return [];
    throw error;
  }
  return (data ?? []).map((r: Record<string, unknown>) => mapPaymentRecord(r));
}

function paymentRecordHasContent(row: PaymentRecordInput): boolean {
  return [
    row.發票號碼,
    row.付款日期,
    row.付款專案,
    row.付款對象,
    row.付款金額,
    row.備註,
  ].some((v) => String(v ?? "").trim() !== "");
}

export async function createPaymentRecordsBatch(rows: PaymentRecordInput[]): Promise<PaymentRecordRow[]> {
  const payload = rows
    .filter(paymentRecordHasContent)
    .map((row) => ({
      發票號碼: trimOrNull(row.發票號碼 ?? undefined),
      付款日期: trimOrNull(row.付款日期 ?? undefined),
      付款專案: trimOrNull(row.付款專案 ?? undefined),
      付款對象: trimOrNull(row.付款對象 ?? undefined),
      付款金額: normalizeMoneyOrNull(row.付款金額 ?? undefined),
      備註: trimOrNull(row.備註 ?? undefined),
    }));

  if (payload.length === 0) {
    throw new Error("請至少填寫一筆付款記錄");
  }

  const { data, error } = await getSupabase().from("付款記錄").insert(payload).select("*");
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => mapPaymentRecord(r));
}

export async function updatePaymentRecordById(id: string, row: PaymentRecordInput): Promise<PaymentRecordRow> {
  const pid = String(id ?? "").trim();
  if (!pid) throw new Error("缺少付款記錄 id");

  const payload = {
    發票號碼: trimOrNull(row.發票號碼 ?? undefined),
    付款日期: trimOrNull(row.付款日期 ?? undefined),
    付款專案: trimOrNull(row.付款專案 ?? undefined),
    付款對象: trimOrNull(row.付款對象 ?? undefined),
    付款金額: normalizeMoneyOrNull(row.付款金額 ?? undefined),
    備註: trimOrNull(row.備註 ?? undefined),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await getSupabase().from("付款記錄").update(payload).eq("id", pid).select("*").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("找不到該付款記錄或更新失敗");
  return mapPaymentRecord(data as Record<string, unknown>);
}

export async function getFinance(): Promise<FinanceRow[]> {
  const { data, error } = await getSupabase().from("財務").select("*").order("created_at", { ascending: false });
  if (error) {
    if (error.code === "42P01") return []; // 表不存在時回傳空陣列，避免 500
    throw error;
  }
  let nameBy專案ID = new Map<string, string>();
  try {
    const masters = await getMasterList();
    const pairs: [string, string][] = masters
      .map((m) => [String(m.專案ID ?? "").trim(), String(m.專案名稱 ?? "").trim()] as [string, string])
      .filter(([id]) => id !== "");
    nameBy專案ID = new Map(pairs);
  } catch {
    /* 大總表讀取失敗時仍回傳財務列，僅無專案名稱 */
  }
  return (data ?? []).map((r: Record<string, unknown>) => {
    const pid = String(r.專案ID ?? "").trim();
    const fromMaster = pid ? nameBy專案ID.get(pid) : undefined;
    const 專案名稱 = fromMaster && fromMaster !== "" ? fromMaster : undefined;
    return mapFinanceDbRow(r, 專案名稱);
  });
}

