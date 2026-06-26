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
  收款對象?: string | null;
  發票金額含稅?: string | null;
  廠商預計付款日?: string | null;
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
    收款對象: r.收款對象 != null ? String(r.收款對象) : undefined,
    發票金額含稅: normalizeMoneyString(r.發票金額含稅),
    廠商預計付款日: r.廠商預計付款日 != null ? String(r.廠商預計付款日) : undefined,
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
    廠商付款日期: r.廠商付款日期 != null ? String(r.廠商付款日期) : undefined,
    員工分潤日期:
      r.員工分潤日期 != null
        ? String(r.員工分潤日期)
        : r.員工分潤狀態 != null
          ? String(r.員工分潤狀態)
          : undefined,
  };
}

function normalizeDateOrNull(v: string | null | undefined): string | null {
  if (v == null || String(v).trim() === "") return null;
  return String(v).trim();
}

/**
 * 依分潤表逐列匯款日，回寫財務「員工分潤日期」（全列已付 → 最晚匯款日；否則清空）。
 */
export async function syncFinanceEmployeeDateFromPayoutRows(專案ID: string): Promise<void> {
  const pid = String(專案ID ?? "").trim();
  if (!pid) return;
  const supabase = getSupabase();
  const { data, error } = await (supabase as ReturnType<typeof getSupabase>)
    .from("分潤表")
    .select('"分潤匯款日期"')
    .eq("專案ID", pid);
  if (error) {
    if (error.code === "42P01") return;
    throw error;
  }
  const rows = (data ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return;

  const dates = rows
    .map((r) => String(r["分潤匯款日期"] ?? "").trim())
    .filter(Boolean);
  let 員工分潤日期: string | null = null;
  if (dates.length === rows.length) {
    員工分潤日期 = [...dates].sort().reverse()[0] ?? null;
  }

  const { error: upErr } = await supabase.from("財務").update({ 員工分潤日期 }).eq("專案ID", pid);
  if (upErr && upErr.code !== "42P01") throw upErr;
}

/**
 * 財務依專案寫入日期後同步分潤表：
 * - 廠商付款日期 → 同專案所有列
 * - 員工分潤日期（僅在專案層新填日期時）→ 僅補上尚未匯款之列，不覆蓋已逐列勾選的日期
 */
async function syncPayoutRowsFromFinanceDates(
  專案ID: string,
  廠商付款日期Val: string | undefined,
  員工分潤日期Val: string | undefined,
  prevFinance?: FinanceRow
): Promise<void> {
  const pid = String(專案ID ?? "").trim();
  if (!pid) return;
  const supabase = getSupabase();
  const vIn = normalizeDateOrNull(廠商付款日期Val);
  const pOut = normalizeDateOrNull(員工分潤日期Val);

  const { error: vendorErr } = await supabase.from("分潤表").update({ 廠商付款日期: vIn }).eq("專案ID", pid);
  if (vendorErr) {
    if (vendorErr.code === "42P01") return;
    throw vendorErr;
  }

  const prevEmp = normalizeDateOrNull(prevFinance?.員工分潤日期);
  const employeeDateChanged = prevEmp !== pOut;
  if (employeeDateChanged && pOut) {
    const { error: bulkErr } = await supabase
      .from("分潤表")
      .update({ 分潤匯款日期: pOut })
      .eq("專案ID", pid)
      .is("分潤匯款日期", null);
    if (bulkErr && bulkErr.code !== "42P01") throw bulkErr;
  }
}

/**
 * 系統內部：由發票同步或分潤回寫更新財務日期（非手動 API）
 */
async function applyFinanceDatesInternal(專案ID: string, row: FinanceUpdateFields): Promise<FinanceRow> {
  const pid = String(專案ID ?? "").trim();
  if (!pid) throw new Error("缺少專案ID");

  const supabase = getSupabase();
  const { data: prevRaw } = await supabase.from("財務").select("*").eq("專案ID", pid).maybeSingle();
  const prevFinance = prevRaw
    ? mapFinanceDbRow(prevRaw as Record<string, unknown>, undefined)
    : undefined;

  const payload: { 廠商付款日期?: string | null; 員工分潤日期?: string | null } = {};
  if (row.廠商付款日期 !== undefined) payload.廠商付款日期 = trimOrNull(row.廠商付款日期);
  if (row.員工分潤日期 !== undefined) payload.員工分潤日期 = trimOrNull(row.員工分潤日期);
  if (Object.keys(payload).length === 0) throw new Error("請提供至少一個可更新欄位");

  const { data, error } = await supabase.from("財務").update(payload).eq("專案ID", pid).select("*").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("找不到該專案之財務列或更新失敗");
  const updated = mapFinanceDbRow(data as Record<string, unknown>, undefined);
  await syncPayoutRowsFromFinanceDates(pid, updated.廠商付款日期, updated.員工分潤日期, prevFinance);
  await syncFinanceEmployeeDateFromPayoutRows(pid);
  return updated;
}

/**
 * 依專案ID 更新財務列（僅供 API；日期欄位不可手動填寫）
 */
export async function updateFinanceBy專案ID(專案ID: string, row: FinanceUpdateFields): Promise<FinanceRow> {
  if (row.廠商付款日期 !== undefined) {
    throw new Error("廠商付款日期請由發票清冊入帳後自動同步，不可手動填寫");
  }
  if (row.員工分潤日期 !== undefined) {
    throw new Error("員工分潤日期請至「員工分潤付款」勾選後自動帶入，不可手動填寫");
  }
  throw new Error("目前無可手動更新的財務欄位");
}

/** 取某專案所有已存檔發票中最晚的廠商付款日（無則 null） */
function resolveVendorPaymentDateFromInvoicesForProject(專案ID: string, invoices: InvoiceRow[]): string | null {
  const dates = invoices
    .filter((inv) => String(inv.專案ID ?? "").trim() === 專案ID)
    .map((inv) => normalizeDateOrNull(inv.廠商付款日期))
    .filter(Boolean) as string[];
  if (dates.length === 0) return null;
  return [...dates].sort().reverse()[0] ?? null;
}

/**
 * 將發票清冊「廠商付款日期」彙整至財務依專案，並同步分潤表。
 * 發票須已綁定專案ID；若財務列不存在會先從大總表建立。
 */
export async function syncFinanceVendorDateFromInvoicesForProject(
  專案ID: string,
  invoicesCache?: InvoiceRow[],
  masterByProjectId?: Map<string, MasterRow>
): Promise<boolean> {
  const pid = String(專案ID ?? "").trim();
  if (!pid) return false;

  const invoices = invoicesCache ?? (await getInvoices());
  const nextVendorDate = resolveVendorPaymentDateFromInvoicesForProject(pid, invoices);
  if (!nextVendorDate) return false;

  const supabase = getSupabase();
  let { data: finRow, error: finErr } = await supabase.from("財務").select("*").eq("專案ID", pid).maybeSingle();
  if (finErr && finErr.code !== "42P01") throw finErr;

  if (!finRow) {
    const masters = await getMasterList();
    const master = masters.find((m) => String(m.專案ID ?? "").trim() === pid);
    if (!master) return false;
    await syncFinanceForProject(master);
    ({ data: finRow, error: finErr } = await supabase.from("財務").select("*").eq("專案ID", pid).maybeSingle());
    if (finErr && finErr.code !== "42P01") throw finErr;
    if (!finRow) return false;
  }

  const current = mapFinanceDbRow(finRow as Record<string, unknown>, undefined);
  const curVendor = normalizeDateOrNull(current.廠商付款日期);

  if (curVendor !== nextVendorDate) {
    await applyFinanceDatesInternal(pid, {
      廠商付款日期: nextVendorDate,
      員工分潤日期: current.員工分潤日期 ?? null,
    });
    return true;
  }

  /** 財務日期已與發票一致時仍補寫分潤表，避免「發票已入帳但員工分潤付款為空」的歷史漏同步 */
  if (nextVendorDate) {
    await syncPayoutRowsFromFinanceDates(pid, nextVendorDate, undefined, current);
  }
  return false;
}

/** 對所有有綁專案的發票，依專案回寫財務廠商付款日（既有資料 backfill 用） */
export async function syncAllFinanceVendorDatesFromInvoices(): Promise<{
  updated: number;
  scanned: number;
}> {
  const invoices = await getInvoices();
  const pids = new Set<string>();
  for (const inv of invoices) {
    const pid = String(inv.專案ID ?? "").trim();
    if (pid) pids.add(pid);
  }
  let updated = 0;
  for (const pid of pids) {
    if (await syncFinanceVendorDateFromInvoicesForProject(pid, invoices)) updated += 1;
  }
  return { updated, scanned: pids.size };
}

async function syncFinanceVendorDatesForInvoiceProjectIds(projectIds: Iterable<string>): Promise<void> {
  const pids = [...new Set([...projectIds].map((id) => String(id ?? "").trim()).filter(Boolean))];
  if (pids.length === 0) return;
  const invoices = await getInvoices();
  for (const pid of pids) {
    try {
      await syncFinanceVendorDateFromInvoicesForProject(pid, invoices);
    } catch {
      /* best effort */
    }
  }
}

/** 發票清冊：固定依「發票號碼」排序（不依建立／更新時間），空白號碼排最後 */
export function sortInvoicesByInvoiceNumber(rows: InvoiceRow[]): InvoiceRow[] {
  return [...rows].sort((a, b) => {
    const na = String(a.發票號碼 ?? "").trim();
    const nb = String(b.發票號碼 ?? "").trim();
    if (!na && !nb) return 0;
    if (!na) return 1;
    if (!nb) return -1;
    return na.localeCompare(nb, "zh-Hant", { numeric: true, sensitivity: "base" });
  });
}

export async function getInvoices(): Promise<InvoiceRow[]> {
  const { data, error } = await getSupabase().from("發票").select("*");

  if (error) {
    if (error.code === "42P01") return []; // 表不存在時回傳空陣列，避免 500
    throw error;
  }
  const rows = (data ?? []).map((r: Record<string, unknown>) => mapInvoiceRecord(r));
  return sortInvoicesByInvoiceNumber(rows);
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
      收款對象: trimOrNull(row.收款對象 ?? undefined),
      發票金額含稅: normalizeMoneyOrNull(row.發票金額含稅 ?? undefined),
      廠商預計付款日: trimOrNull(row.廠商預計付款日 ?? undefined),
      廠商付款日期: trimOrNull(row.廠商付款日期 ?? undefined),
      備註: trimOrNull(row.備註 ?? undefined),
    }))
    .filter((r) => r.發票號碼 != null);

  if (payload.length === 0) {
    throw new Error("請至少填寫一筆發票號碼");
  }

  const { data, error } = await getSupabase().from("發票").insert(payload).select("*");
  if (error) throw error;
  const created = (data ?? []).map((r: Record<string, unknown>) => mapInvoiceRecord(r));
  await syncFinanceVendorDatesForInvoiceProjectIds(
    created.map((r) => String(r.專案ID ?? "").trim()).filter(Boolean)
  );
  return created;
}

/**
 * 更新發票（依 id）。須提供完整可編輯欄位；發票號碼不可空白。
 */
export async function updateInvoiceById(id: string, row: InvoiceInsertInput): Promise<InvoiceRow> {
  const pid = String(id ?? "").trim();
  if (!pid) throw new Error("缺少發票 id");

  const 發票號碼 = trimOrNull(row.發票號碼 ?? undefined);
  if (發票號碼 == null) throw new Error("發票號碼不可空白");

  const { data: prevRaw } = await getSupabase().from("發票").select('"專案ID"').eq("id", pid).maybeSingle();
  const prevProjectId =
    prevRaw && typeof prevRaw === "object" && "專案ID" in prevRaw
      ? String((prevRaw as { 專案ID?: unknown }).專案ID ?? "").trim()
      : "";

  const payload = {
    專案ID: trimOrNull(row.專案ID ?? undefined),
    發票號碼,
    發票日期: trimOrNull(row.發票日期 ?? undefined),
    收款對象: trimOrNull(row.收款對象 ?? undefined),
    發票金額含稅: normalizeMoneyOrNull(row.發票金額含稅 ?? undefined),
    廠商預計付款日: trimOrNull(row.廠商預計付款日 ?? undefined),
    廠商付款日期: trimOrNull(row.廠商付款日期 ?? undefined),
    備註: trimOrNull(row.備註 ?? undefined),
  };

  const { data, error } = await getSupabase().from("發票").update(payload).eq("id", pid).select("*").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("找不到該發票或更新失敗");
  const updated = mapInvoiceRecord(data as Record<string, unknown>);
  const nextProjectId = String(updated.專案ID ?? "").trim();
  await syncFinanceVendorDatesForInvoiceProjectIds([prevProjectId, nextProjectId].filter(Boolean));
  return updated;
}

export async function deleteInvoicesByIds(ids: string[]): Promise<number> {
  const cleanIds = [...new Set(ids.map((id) => String(id ?? "").trim()).filter(Boolean))];
  if (cleanIds.length === 0) throw new Error("請至少選擇一筆發票");

  const { data: beforeDelete } = await getSupabase().from("發票").select('"專案ID"').in("id", cleanIds);
  const affectedProjectIds = (beforeDelete ?? [])
    .map((r) => String((r as { 專案ID?: unknown }).專案ID ?? "").trim())
    .filter(Boolean);

  const { error, count } = await getSupabase()
    .from("發票")
    .delete({ count: "exact" })
    .in("id", cleanIds);
  if (error) throw error;
  await syncFinanceVendorDatesForInvoiceProjectIds(affectedProjectIds);
  return count ?? cleanIds.length;
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

export async function createPaymentRecordsBatch(
  rows: PaymentRecordInput[],
  options?: { allowBlank?: boolean }
): Promise<PaymentRecordRow[]> {
  const sourceRows = options?.allowBlank ? rows : rows.filter(paymentRecordHasContent);
  const payload = sourceRows
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

