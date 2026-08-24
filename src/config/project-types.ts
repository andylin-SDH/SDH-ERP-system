/**
 * 專案類型選項（用於下拉選單）
 */

import { normalizeDecimalString } from "@/lib/number-normalize";

export const PROJECT_TYPES = ["KOL開發", "廣告業配", "團購", "製作案", "活動案", "其他"] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

function normalizeProjectTypeKey(專案類型: string | null | undefined): string {
  return String(專案類型 ?? "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();
}

/**
 * 專案類型 → 專案成本自動帶入（已停用：專案成本改為「額外成本注記」，不參與計算、不自動帶入）。
 * 保留常數以免舊程式引用炸掉；請勿再呼叫。
 */
export const PROJECT_TYPE_COST_RATIO_OF_TOTAL: Record<string, number> = {};

/** @deprecated 專案額外成本注記不自動計算 */
export function costFromTotalByProjectType(
  _專案類型: string | null | undefined,
  _專案總金額未稅: string
): string | null {
  return null;
}

/**
 * 專案盈餘成數（寫入 DB 欄位仍為「專案營收」，畫面顯示「專案盈餘」）。
 * 製作案 30%；廣告業配／業配案 20%。
 */
export const PROJECT_TYPE_SURPLUS_RATE: Record<string, number> = {
  製作案: 0.3,
  廣告業配: 0.2,
  業配案: 0.2,
};

export function projectSurplusRate(專案類型: string | null | undefined): number | null {
  const t = normalizeProjectTypeKey(專案類型);
  if (!t) return null;
  return PROJECT_TYPE_SURPLUS_RATE[t] ?? null;
}

/**
 * 專案盈餘 = (總金額未稅×1.05 − KOL費用未稅×1.05) × 成數
 * 無對應成數的專案類型回傳 "0"（避免分潤回退用總金額）。
 */
export function calc專案盈餘(
  專案類型: string | null | undefined,
  專案總金額未稅: string | null | undefined,
  KOL費用未稅: string | null | undefined
): string {
  const rate = projectSurplusRate(專案類型);
  if (rate == null) return "0";
  const total = Number(String(專案總金額未稅 ?? "").replace(/,/g, "")) || 0;
  const kol = Number(String(KOL費用未稅 ?? "").replace(/,/g, "")) || 0;
  const surplus = (total * 1.05 - kol * 1.05) * rate;
  return normalizeDecimalString(surplus, 2) ?? "0";
}

export function projectSurplusFormulaHint(專案類型: string | null | undefined): string {
  const rate = projectSurplusRate(專案類型);
  if (rate == null) {
    return "僅製作案（×30%）、廣告業配（×20%）自動計算；其他類型目前為 0";
  }
  const pct = Math.round(rate * 100);
  return `自動計算：(總金額未稅×1.05 − KOL費用未稅×1.05)×${pct}%`;
}
