import { calcB2bTotals, type B2bPriceMode, type B2bTaxKind } from "@/lib/invoice/b2b-amount";
import { issueB2bInvoice, taipeiDateFromUnix } from "@/lib/invoice/amego";
import { orderIdForIssue } from "@/lib/invoice/order-id";
import { insertIssuedInvoice } from "@/lib/db/finance";
import { sendInvoiceIssuedEmail } from "@/lib/email";
import { getEmailByNameOrEmail } from "@/lib/db/users";
import { getSupabase } from "@/lib/supabase/server";

export type InvoiceRequestLine = {
  description: string;
  quantity: number;
  unitPrice: number;
};

/** 放行審核時並排顯示的專案摘要（從大總表帶出，不另開浮窗） */
export type InvoiceRequestProjectSummary = {
  專案ID: string;
  專案名稱: string;
  專案狀態: string;
  開案日期: string;
  廠商名稱: string;
  統一編號: string;
  收件人Email: string;
  KOL名稱: string;
  執行管理員: string;
  專案總金額未稅: string;
  專案成本: string;
  KOL費用未稅: string;
  KOL應收額外成本: string;
  專案營收: string;
  廠商預計付款日: string;
  專案內容: string;
};

export type InvoiceRequestRow = {
  id: string;
  狀態: string;
  專案ID: string;
  買受人統編: string;
  買受人名稱: string;
  買受人Email: string;
  買受人地址: string;
  發票備註: string;
  課稅別: string;
  單價模式: string;
  通關方式: number | null;
  零稅率原因: number | null;
  明細: InvoiceRequestLine[];
  銷售額: string;
  稅額: string;
  發票總金額: string;
  申請人Email: string;
  申請人: string;
  申請時間: string;
  審核人: string;
  審核時間: string;
  退回原因: string;
  訂單編號: string;
  發票號碼: string;
  發票日期: string;
  隨機碼: string;
  開立錯誤: string;
  已有發票: boolean;
  外部單號: string;
  專案摘要: InvoiceRequestProjectSummary | null;
};

export type InvoiceRequestInput = {
  projectId: string;
  buyerIdentifier: string;
  buyerName: string;
  buyerEmail: string;
  buyerAddress: string;
  remark: string;
  taxKind: B2bTaxKind;
  priceMode: B2bPriceMode;
  customsClearanceMark?: number;
  zeroTaxRateReason?: number;
  items: InvoiceRequestLine[];
  申請人Email: string;
  申請人: string;
  /** 外部來源訂單編號。有值時同一單號只建一筆，已存在則原樣回傳。 */
  外部單號?: string;
};

function text(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function mapRow(
  row: Record<string, unknown>,
  issuedProjectIds: Set<string>,
  projectById: Map<string, InvoiceRequestProjectSummary> = new Map()
): InvoiceRequestRow {
  const rawItems = row.明細;
  const items = Array.isArray(rawItems)
    ? rawItems.map((item) => {
        const line = item as Record<string, unknown>;
        return {
          description: text(line.description),
          quantity: Number(line.quantity),
          unitPrice: Number(line.unitPrice),
        };
      })
    : [];
  const projectId = text(row.專案ID);
  return {
    id: text(row.id),
    狀態: text(row.狀態) || "待審核",
    專案ID: projectId,
    買受人統編: text(row.買受人統編),
    買受人名稱: text(row.買受人名稱),
    買受人Email: text(row.買受人Email),
    買受人地址: text(row.買受人地址),
    發票備註: text(row.發票備註),
    課稅別: text(row.課稅別),
    單價模式: text(row.單價模式),
    通關方式: row.通關方式 == null ? null : Number(row.通關方式),
    零稅率原因: row.零稅率原因 == null ? null : Number(row.零稅率原因),
    明細: items,
    銷售額: text(row.銷售額),
    稅額: text(row.稅額),
    發票總金額: text(row.發票總金額),
    申請人Email: text(row.申請人Email),
    申請人: text(row.申請人),
    申請時間: text(row.申請時間),
    審核人: text(row.審核人),
    審核時間: text(row.審核時間),
    退回原因: text(row.退回原因),
    訂單編號: text(row.訂單編號),
    發票號碼: text(row.發票號碼),
    發票日期: text(row.發票日期),
    隨機碼: text(row.隨機碼),
    開立錯誤: text(row.開立錯誤),
    已有發票: projectId !== "" && issuedProjectIds.has(projectId),
    外部單號: text(row.外部單號),
    專案摘要: projectId ? projectById.get(projectId) ?? null : null,
  };
}

function money(value: unknown): string {
  const raw = text(value);
  if (!raw) return "";
  const n = Number(String(raw).replace(/,/g, ""));
  if (!Number.isFinite(n)) return raw;
  return String(n);
}

function calcRevenue(total: string, cost: string, kol: string): string {
  const a = Number(total) || 0;
  const b = Number(cost) || 0;
  const c = Number(kol) || 0;
  if (!total && !cost && !kol) return "";
  return String(a - b - c);
}

async function projectSummariesByIds(projectIds: string[]): Promise<Map<string, InvoiceRequestProjectSummary>> {
  const ids = [...new Set(projectIds.map((id) => text(id)).filter(Boolean))];
  const map = new Map<string, InvoiceRequestProjectSummary>();
  if (ids.length === 0) return map;
  const columnSets = [
    '"專案ID","專案名稱","專案狀態","開案日期","廠商名稱","統一編號","收件人Email","KOL名稱","執行管理員","專案總金額未稅","專案成本","KOL費用未稅","KOL應收額外成本","專案營收","廠商預計付款日","專案內容"',
    '"專案ID","專案名稱","專案狀態","開案日期","廠商名稱","統一編號","KOL名稱","執行管理員","專案總金額未稅","專案成本","KOL費用未稅","KOL應收額外成本","專案營收","廠商預計付款日","專案內容"',
    '"專案ID","專案名稱","專案狀態","開案日期","廠商名稱","KOL名稱","執行管理員","專案總金額未稅","專案成本","KOL費用未稅","KOL應收額外成本","專案營收","廠商預計付款日","專案內容"',
  ];
  let data: unknown[] | null = null;
  for (const columns of columnSets) {
    const result = await getSupabase().from("大總表").select(columns).in("專案ID", ids);
    if (!result.error) {
      data = result.data;
      break;
    }
    if (!/收件人Email|統一編號|schema cache|column/i.test(result.error.message ?? "")) return map;
  }
  if (!data) return map;
  for (const row of data) {
    const r = row as Record<string, unknown>;
    const id = text(r.專案ID);
    if (!id) continue;
    const total = money(r.專案總金額未稅);
    const cost = money(r.專案成本);
    const kolFee = money(r.KOL費用未稅);
    const storedRevenue = money(r.專案營收);
    map.set(id, {
      專案ID: id,
      專案名稱: text(r.專案名稱),
      專案狀態: text(r.專案狀態),
      開案日期: text(r.開案日期),
      廠商名稱: text(r.廠商名稱),
      統一編號: text(r.統一編號),
      收件人Email: text(r.收件人Email),
      KOL名稱: text(r.KOL名稱),
      執行管理員: text(r.執行管理員),
      專案總金額未稅: total,
      專案成本: cost,
      KOL費用未稅: kolFee,
      KOL應收額外成本: money(r.KOL應收額外成本),
      專案營收: storedRevenue || calcRevenue(total, cost, kolFee),
      廠商預計付款日: text(r.廠商預計付款日),
      專案內容: text(r.專案內容),
    });
  }
  return map;
}

function missingTable(error: { code?: string; message?: string } | null): boolean {
  const message = String(error?.message ?? "");
  return error?.code === "42P01" || /發票開立申請/.test(message);
}

function missingExternalOrderColumn(error: { code?: string; message?: string } | null): boolean {
  const message = String(error?.message ?? "");
  return error?.code === "42703" || /外部單號/.test(message);
}

async function issuedProjectIds(): Promise<Set<string>> {
  const { data, error } = await getSupabase().from("發票").select("專案ID");
  if (error) return new Set();
  return new Set(
    (data ?? [])
      .map((row) => text((row as { 專案ID?: string }).專案ID))
      .filter(Boolean)
  );
}

export async function listInvoiceRequests(filterEmail?: string): Promise<InvoiceRequestRow[]> {
  const supabase = getSupabase();
  let query = supabase.from("發票開立申請").select("*").order("申請時間", { ascending: false });
  if (filterEmail) query = query.eq("申請人Email", filterEmail);
  const { data, error } = await query;
  if (error) {
    if (missingTable(error)) throw new Error("發票開立申請表還沒建立，請先執行 migration 076");
    throw error;
  }
  const issued = await issuedProjectIds();
  const projectIds = (data ?? []).map((row) => text((row as { 專案ID?: string }).專案ID));
  const projects = await projectSummariesByIds(projectIds);
  return (data ?? []).map((row) => mapRow(row as Record<string, unknown>, issued, projects));
}

export async function createInvoiceRequest(input: InvoiceRequestInput): Promise<InvoiceRequestRow> {
  const totals = calcB2bTotals(input.items, input.taxKind, input.priceMode);
  if (totals.lines.length === 0 || totals.totalAmount <= 0) {
    throw new Error("請至少填一筆品名、數量與單價");
  }
  const payload = {
    狀態: "待審核",
    專案ID: input.projectId || null,
    買受人統編: input.buyerIdentifier,
    買受人名稱: input.buyerName,
    買受人Email: input.buyerEmail,
    買受人地址: input.buyerAddress || null,
    發票備註: input.remark || null,
    課稅別: input.taxKind,
    單價模式: input.priceMode,
    通關方式: input.taxKind === "zero" ? input.customsClearanceMark ?? 1 : null,
    零稅率原因: input.taxKind === "zero" ? input.zeroTaxRateReason ?? 72 : null,
    明細: totals.lines.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
    })),
    銷售額: String(
      input.taxKind === "exempt"
        ? totals.freeTaxSalesAmount
        : input.taxKind === "zero"
          ? totals.zeroTaxSalesAmount
          : totals.salesAmount
    ),
    稅額: String(totals.taxAmount),
    發票總金額: String(totals.totalAmount),
    申請人Email: input.申請人Email,
    申請人: input.申請人 || input.申請人Email,
    ...(input.外部單號 ? { 外部單號: input.外部單號 } : {}),
  };
  const { data, error } = await getSupabase().from("發票開立申請").insert(payload).select("*").single();
  if (error) {
    if (missingTable(error)) throw new Error("發票開立申請表還沒建立，請先執行 migration 076");
    if (input.外部單號 && missingExternalOrderColumn(error)) {
      throw new Error("發票開立申請尚未有外部單號欄位，請先執行 migration 083");
    }
    throw error;
  }
  return mapRow(data as Record<string, unknown>, await issuedProjectIds());
}

export async function findInvoiceRequestByExternalOrder(externalOrderId: string): Promise<InvoiceRequestRow | null> {
  const key = externalOrderId.trim();
  if (!key) return null;
  const { data, error } = await getSupabase().from("發票開立申請").select("*").eq("外部單號", key).maybeSingle();
  if (error) {
    if (missingExternalOrderColumn(error)) {
      throw new Error("發票開立申請尚未有外部單號欄位，請先執行 migration 083");
    }
    throw error;
  }
  if (!data) return null;
  return mapRow(data as Record<string, unknown>, await issuedProjectIds());
}

/** 同一外部單號已有申請就原樣回傳，不更新金額或買受人。 */
export async function ingestExternalInvoiceRequest(
  input: InvoiceRequestInput & { 外部單號: string }
): Promise<{ request: InvoiceRequestRow; alreadyExists: boolean }> {
  const key = input.外部單號.trim();
  const existing = await findInvoiceRequestByExternalOrder(key);
  if (existing) return { request: existing, alreadyExists: true };
  try {
    const created = await createInvoiceRequest({ ...input, 外部單號: key });
    return { request: created, alreadyExists: false };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "23505") {
      const again = await findInvoiceRequestByExternalOrder(key);
      if (again) return { request: again, alreadyExists: true };
    }
    throw error;
  }
}

export async function rejectInvoiceRequest(id: string, reason: string, reviewer: string): Promise<InvoiceRequestRow> {
  const supabase = getSupabase();
  const { data: current, error: readErr } = await supabase.from("發票開立申請").select("*").eq("id", id).maybeSingle();
  if (readErr) throw readErr;
  if (!current) throw new Error("找不到這筆申請");
  if (text((current as { 狀態?: string }).狀態) !== "待審核") throw new Error("這筆申請已經審過");
  const { data, error } = await supabase
    .from("發票開立申請")
    .update({
      狀態: "已退回",
      退回原因: reason,
      審核人: reviewer,
      審核時間: new Date().toISOString(),
      開立錯誤: null,
    })
    .eq("id", id)
    .eq("狀態", "待審核")
    .select("*")
    .single();
  if (error) throw error;
  return mapRow(data as Record<string, unknown>, await issuedProjectIds());
}

export async function approveInvoiceRequest(id: string, reviewer: string): Promise<InvoiceRequestRow> {
  const supabase = getSupabase();
  const { data: current, error: readErr } = await supabase.from("發票開立申請").select("*").eq("id", id).maybeSingle();
  if (readErr) throw readErr;
  if (!current) throw new Error("找不到這筆申請");
  const row = mapRow(current as Record<string, unknown>, new Set());
  if (row.狀態 !== "待審核") throw new Error("這筆申請已經審過");

  const taxKind: B2bTaxKind = row.課稅別 === "zero" || row.課稅別 === "exempt" ? row.課稅別 : "taxable";
  const priceMode: B2bPriceMode = row.單價模式 === "taxed" ? "taxed" : "untaxed";
  const totals = calcB2bTotals(row.明細, taxKind, priceMode);
  if (totals.lines.length === 0) throw new Error("這筆申請沒有品項");

  let orderId = row.訂單編號;
  let invoiceNumber = row.發票號碼;
  let invoiceDate = row.發票日期;
  let randomNumber = row.隨機碼;
  try {
    if (!invoiceNumber) {
      orderId = await orderIdForIssue(row.專案ID);
      const issued = await issueB2bInvoice({
        orderId,
        buyerIdentifier: row.買受人統編,
        buyerName: row.買受人名稱,
        buyerEmail: row.買受人Email,
        buyerAddress: row.買受人地址,
        remark: row.發票備註,
        totals,
        customsClearanceMark: row.通關方式 ?? undefined,
        zeroTaxRateReason: row.零稅率原因 ?? undefined,
      });
      invoiceNumber = issued.invoiceNumber;
      invoiceDate = taipeiDateFromUnix(issued.invoiceTime);
      randomNumber = issued.randomNumber;
      await supabase
        .from("發票開立申請")
        .update({
          訂單編號: orderId,
          發票號碼: invoiceNumber,
          發票日期: invoiceDate,
          隨機碼: randomNumber,
          開立錯誤: null,
        })
        .eq("id", id)
        .eq("狀態", "待審核");
    }
    await insertIssuedInvoice({
      projectId: row.專案ID,
      發票號碼: invoiceNumber,
      發票日期: invoiceDate,
      收款對象: row.買受人名稱,
      發票金額含稅: String(totals.totalAmount),
      備註: row.發票備註,
    });
    const { data, error } = await supabase
      .from("發票開立申請")
      .update({
        狀態: "已放行",
        審核人: reviewer,
        審核時間: new Date().toISOString(),
        訂單編號: orderId,
        發票號碼: invoiceNumber,
        發票日期: invoiceDate,
        隨機碼: randomNumber,
        開立錯誤: null,
      })
      .eq("id", id)
      .eq("狀態", "待審核")
      .select("*")
      .single();
    if (error) throw error;
    const issued = mapRow(data as Record<string, unknown>, await issuedProjectIds());
    return issued;
  } catch (error) {
    const message = error instanceof Error ? error.message : "開立失敗";
    await supabase
      .from("發票開立申請")
      .update({ 開立錯誤: message, 訂單編號: orderId || null })
      .eq("id", id)
      .eq("狀態", "待審核");
    throw error;
  }
}

function canEmailApplicant(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !email.toLowerCase().endsWith(".local");
}

/** 開立已完成才呼叫。寄給專案上的專案負責人與主管，同一人只寄一封。寄信失敗不影響已開立的發票。 */
export async function notifyInvoiceApplicant(row: InvoiceRequestRow): Promise<string> {
  if (!row.專案ID.trim()) return "已開立。這筆沒有對應專案，未寄通知。";
  const { data } = await getSupabase()
    .from("大總表")
    .select("專案名稱,執行管理員,直屬主管")
    .eq("專案ID", row.專案ID)
    .maybeSingle();
  const project = data as { 專案名稱?: string; 執行管理員?: string; 直屬主管?: string } | null;
  const projectName = text(project?.專案名稱);
  const people = new Map<string, string[]>();
  const addPerson = (name: string, role: string) => {
    const key = name.trim();
    if (!key) return;
    const roles = people.get(key) ?? [];
    if (!roles.includes(role)) roles.push(role);
    people.set(key, roles);
  };
  addPerson(text(project?.執行管理員), "專案負責人");
  addPerson(text(project?.直屬主管), "主管");
  if (people.size === 0) return "已開立。這個專案沒有填專案負責人或主管，未寄通知。";

  const sent: string[] = [];
  const missed: string[] = [];
  for (const [name, roles] of people) {
    const label = `${roles.join("／")} ${name}`;
    try {
      const to = (await getEmailByNameOrEmail(name))?.trim() ?? "";
      if (!canEmailApplicant(to)) {
        missed.push(`${label} 沒有對到可寄送的帳號信箱`);
        continue;
      }
      const result = await sendInvoiceIssuedEmail({
        to,
        applicantName: name,
        invoiceNumber: row.發票號碼,
        invoiceDate: row.發票日期,
        buyerName: row.買受人名稱,
        totalAmount: row.發票總金額,
        projectId: row.專案ID,
        projectName,
        reviewer: row.審核人,
      });
      if (!result.ok) missed.push(`${label} 沒有寄出：${result.error || "寄信失敗"}`);
      else sent.push(`${label}（${to}）`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "寄信失敗";
      console.error("notifyInvoiceApplicant", error);
      missed.push(`${label} 沒有寄出：${message}`);
    }
  }
  if (sent.length === 0) return `已開立，通知信未寄出。${missed.join("；")}`;
  const ok = `已開立，已寄信通知 ${sent.join("、")}`;
  return missed.length ? `${ok}。另外${missed.join("；")}` : ok;
}
