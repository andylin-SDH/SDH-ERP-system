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

export function taipeiDateFromUnix(seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}
