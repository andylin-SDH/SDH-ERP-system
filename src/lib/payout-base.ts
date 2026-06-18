/**
 * 分潤計算基準：優先使用專案關聯發票的含稅金額加總，無發票時退回專案營收。
 */

import { parseAmount } from "@/lib/payout-utils";

export type PayoutBaseSource = "invoice" | "project";

export type InvoiceAmountRow = {
  專案ID?: string | null;
  發票金額含稅?: string | null;
};

/** 某專案已綁定發票的「發票金額含稅」加總 */
export function sumInvoiceAmountForProject(專案ID: string, invoices: InvoiceAmountRow[]): number {
  const pid = String(專案ID ?? "").trim();
  if (!pid) return 0;
  let sum = 0;
  for (const inv of invoices) {
    if (String(inv.專案ID ?? "").trim() !== pid) continue;
    sum += parseAmount(inv.發票金額含稅);
  }
  return sum;
}

export function resolvePayoutBaseAmount(
  專案ID: string,
  invoices: InvoiceAmountRow[],
  project: { 專案營收?: string | null; 專案總金額未稅?: string | null }
): { amount: number; source: PayoutBaseSource; 分潤基準金額: string | null } {
  const invoiceSum = sumInvoiceAmountForProject(專案ID, invoices);
  if (invoiceSum > 0) {
    return { amount: invoiceSum, source: "invoice", 分潤基準金額: String(Math.round(invoiceSum)) };
  }
  const fallback = project.專案營收 ?? project.專案總金額未稅 ?? null;
  return {
    amount: parseAmount(fallback),
    source: "project",
    分潤基準金額: fallback != null && String(fallback).trim() !== "" ? String(fallback).trim() : null,
  };
}
