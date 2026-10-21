import { createHash } from "crypto";
import type { B2bTotals } from "@/lib/invoice/b2b-amount";

const API_BASE = (process.env.AMEGO_API_BASE || "https://invoice-api.amego.tw").replace(/\/$/, "");

export type AmegoIssueInput = {
  orderId: string;
  buyerIdentifier: string;
  buyerName: string;
  buyerEmail: string;
  buyerAddress: string;
  remark: string;
  totals: B2bTotals;
  customsClearanceMark?: number;
  zeroTaxRateReason?: number;
};

export type AmegoIssueResult = {
  invoiceNumber: string;
  invoiceTime: number;
  randomNumber: string;
};

function credentials(): { ban: string; appKey: string } {
  const ban = String(process.env.AMEGO_INVOICE_BAN ?? "").trim();
  const appKey = String(process.env.AMEGO_APP_KEY ?? "").trim();
  if (!ban || !appKey) {
    throw new Error("尚未設定 AMEGO_INVOICE_BAN 與 AMEGO_APP_KEY");
  }
  return { ban, appKey };
}

function sign(data: string, time: string, appKey: string): string {
  return createHash("md5").update(data + time + appKey).digest("hex");
}

async function postAmego(path: string, data: string): Promise<Record<string, unknown>> {
  const { ban, appKey } = credentials();
  const time = String(Math.floor(Date.now() / 1000));
  const body = new URLSearchParams();
  body.set("invoice", ban);
  body.set("data", data);
  body.set("time", time);
  body.set("sign", sign(data, time, appKey));

  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new Error(text.trim().slice(0, 200) || `光貿回應不是 JSON（HTTP ${res.status}）`);
  }
  const code = json.code;
  if (code !== 0 && code !== "0") {
    const msg = String(json.msg ?? json.message ?? "").trim();
    throw new Error(msg || `光貿開立失敗（code ${String(code ?? res.status)}）`);
  }
  return json;
}

export async function issueB2bInvoice(input: AmegoIssueInput): Promise<AmegoIssueResult> {
  const totals = input.totals;
  const payload: Record<string, unknown> = {
    OrderId: input.orderId,
    BuyerIdentifier: input.buyerIdentifier,
    BuyerName: input.buyerName,
    BuyerAddress: input.buyerAddress,
    BuyerEmailAddress: input.buyerEmail,
    MainRemark: input.remark,
    ProductItem: totals.lines.map((line) => ({
      Description: line.description,
      Quantity: line.quantity,
      UnitPrice: line.unitPrice,
      Amount: line.amount,
      TaxType: line.taxType,
    })),
    SalesAmount: totals.salesAmount,
    FreeTaxSalesAmount: totals.freeTaxSalesAmount,
    ZeroTaxSalesAmount: totals.zeroTaxSalesAmount,
    TaxType: totals.taxType,
    TaxRate: totals.taxRate,
    TaxAmount: totals.taxAmount,
    TotalAmount: totals.totalAmount,
    DetailVat: totals.detailVat,
  };
  if (totals.taxType === 2) {
    payload.CustomsClearanceMark = input.customsClearanceMark ?? 1;
    payload.ZeroTaxRateReason = input.zeroTaxRateReason ?? 72;
  }

  const json = await postAmego("/json/f0401", JSON.stringify(payload));
  const invoiceNumber = String(json.invoice_number ?? "").trim();
  const invoiceTime = Number(json.invoice_time);
  const randomNumber = String(json.random_number ?? "").trim();
  if (!invoiceNumber) throw new Error("光貿沒有回傳發票號碼");
  return {
    invoiceNumber,
    invoiceTime: Number.isFinite(invoiceTime) ? invoiceTime : Math.floor(Date.now() / 1000),
    randomNumber,
  };
}

export async function voidInvoice(invoiceNumber: string, reason: string): Promise<void> {
  const data = JSON.stringify([
    {
      CancelInvoiceNumber: invoiceNumber,
      CancelReason: reason,
    },
  ]);
  await postAmego("/json/f0501", data);
}

/** 光貿 invoice_status 的 status 代碼 */
export type AmegoInvoiceStatusCode = 1 | 2 | 3 | 31 | 32 | 91 | 99 | number;

export type AmegoInvoiceStatus = {
  invoiceNumber: string;
  type: string;
  status: AmegoInvoiceStatusCode;
  totalAmount: number | null;
};

const AMEGO_STATUS_LABEL: Record<number, string> = {
  1: "待處理",
  2: "上傳中",
  3: "已上傳",
  31: "處理中",
  32: "處理完成／待確認",
  91: "錯誤",
  99: "完成",
};

export function amegoStatusLabel(status: number): string {
  return AMEGO_STATUS_LABEL[status] ?? `狀態 ${status}`;
}

export function amegoTypeLabel(type: string): string {
  const t = String(type ?? "").trim().toUpperCase();
  if (t === "C0401") return "發票開立";
  if (t === "C0501") return "發票作廢";
  if (t === "C0701") return "發票註銷";
  if (t === "NOT_FOUND") return "查無發票";
  if (t === "TYPE_ERROR") return "類型錯誤";
  return t || "未知";
}

/** 財政部已接收完成後才能作廢（光貿文件） */
export function amegoCanVoid(status: AmegoInvoiceStatus): boolean {
  const type = String(status.type ?? "").trim().toUpperCase();
  return type === "C0401" && Number(status.status) === 99;
}

export function amegoVoidBlockReason(status: AmegoInvoiceStatus): string | null {
  const type = String(status.type ?? "").trim().toUpperCase();
  const code = Number(status.status);
  if (type === "NOT_FOUND") return "光貿查無此發票號碼";
  if (type === "C0501") return "這張發票在光貿已作廢";
  if (type === "C0701") return "這張發票在光貿已註銷，無法再作廢";
  if (type !== "C0401") return `目前類型為「${amegoTypeLabel(type)}」，無法作廢`;
  if (code === 91) return "開立後上傳國稅局失敗（光貿狀態：錯誤）。請稍後再查，或聯繫光貿／會計確認。";
  if (code === 99) return null;
  return `光貿尚未上傳完成（目前：${amegoStatusLabel(code)}）。等狀態變「完成」後才能作廢。`;
}

function parseAmegoStatusRow(row: Record<string, unknown>, fallbackNumber: string): AmegoInvoiceStatus {
  const foundNumber = String(row.invoice_number ?? fallbackNumber).trim().toUpperCase();
  const type = String(row.type ?? "").trim();
  const status = Number(row.status);
  const totalRaw = row.total_amount;
  const totalAmount =
    totalRaw === null || totalRaw === undefined || totalRaw === ""
      ? null
      : Number(totalRaw);
  return {
    invoiceNumber: foundNumber || fallbackNumber,
    type: type || "NOT_FOUND",
    status: Number.isFinite(status) ? status : 0,
    totalAmount: totalAmount != null && Number.isFinite(totalAmount) ? totalAmount : null,
  };
}

/** 按需單次查詢；不自動輪詢 */
export async function getInvoiceStatus(invoiceNumber: string): Promise<AmegoInvoiceStatus> {
  const number = String(invoiceNumber ?? "").trim().toUpperCase();
  const json = await postAmego("/json/invoice_status", JSON.stringify([{ InvoiceNumber: number }]));
  const rows = Array.isArray(json.data) ? json.data : [];
  return parseAmegoStatusRow((rows[0] ?? {}) as Record<string, unknown>, number);
}

const STATUS_BATCH_SIZE = 40;

/** 批次查詢（刷新鈕用）；一次最多 STATUS_BATCH_SIZE 張 */
export async function getInvoiceStatuses(invoiceNumbers: string[]): Promise<AmegoInvoiceStatus[]> {
  const unique = [
    ...new Set(
      invoiceNumbers
        .map((n) => String(n ?? "").trim().toUpperCase())
        .filter((n) => /^[A-Z]{2}\d{8}$/.test(n))
    ),
  ];
  if (unique.length === 0) return [];

  const out: AmegoInvoiceStatus[] = [];
  for (let i = 0; i < unique.length; i += STATUS_BATCH_SIZE) {
    const chunk = unique.slice(i, i + STATUS_BATCH_SIZE);
    const json = await postAmego(
      "/json/invoice_status",
      JSON.stringify(chunk.map((InvoiceNumber) => ({ InvoiceNumber })))
    );
    const rows = Array.isArray(json.data) ? json.data : [];
    const byNumber = new Map<string, AmegoInvoiceStatus>();
    for (const raw of rows) {
      const parsed = parseAmegoStatusRow((raw ?? {}) as Record<string, unknown>, "");
      if (parsed.invoiceNumber) byNumber.set(parsed.invoiceNumber, parsed);
    }
    for (const number of chunk) {
      out.push(byNumber.get(number) ?? { invoiceNumber: number, type: "NOT_FOUND", status: 0, totalAmount: null });
    }
  }
  return out;
}

/** 光貿狀態查詢的類型已是發票作廢 */
export function amegoIsVoidConfirmed(status: AmegoInvoiceStatus): boolean {
  return String(status.type ?? "").trim().toUpperCase() === "C0501";
}

/** 寫入清冊用的狀態文案；查無發票回 null（不覆蓋既有） */
export function amegoUploadStatusLabel(status: AmegoInvoiceStatus): string | null {
  const type = String(status.type ?? "").trim().toUpperCase();
  if (type === "NOT_FOUND" || !type) return null;
  if (type === "C0501") return "已作廢";
  if (type === "C0701") return "已註銷";
  if (type === "TYPE_ERROR") return "類型錯誤";
  return amegoStatusLabel(Number(status.status));
}

export function taipeiDateFromUnix(seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}
