/**
 * 專案類型選項（用於下拉選單）
 */

import { normalizeDecimalString } from "@/lib/number-normalize";

export const PROJECT_TYPES = ["KOL開發", "廣告業配", "團購", "製作案", "活動案", "其他"] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

/**
 * 專案類型 → 專案成本自動帶入（可選）。
 * 例：製作案預設成本為總額 70%。鍵名須與「專案類型」下拉選項完全一致。
 * 目前不強制自動帶入；保留常數供日後啟用。
 */
export const PROJECT_TYPE_COST_RATIO_OF_TOTAL: Record<string, number> = {
  製作案: 0.7,
};

/** 若專案類型有對應比例，回傳應帶入之專案成本字串；否則 null（維持手動輸入） */
export function costFromTotalByProjectType(
  專案類型: string | null | undefined,
  專案總金額未稅: string
): string | null {
  const t = String(專案類型 ?? "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();
  const ratio = PROJECT_TYPE_COST_RATIO_OF_TOTAL[t];
  if (ratio == null) return null;
  const total = Number(String(專案總金額未稅).replace(/,/g, "")) || 0;
  return String(Math.round(total * ratio));
}

/**
 * 專案營收 = 專案總金額未稅 − 專案額外成本 − KOL費用未稅
 * （DB 欄位：專案營收、專案成本、KOL費用未稅）
 */
export function calc專案營收(
  專案總金額未稅: string | null | undefined,
  專案成本: string | null | undefined,
  KOL費用未稅: string | null | undefined
): string {
  const total = Number(String(專案總金額未稅 ?? "").replace(/,/g, "")) || 0;
  const cost = Number(String(專案成本 ?? "").replace(/,/g, "")) || 0;
  const kol = Number(String(KOL費用未稅 ?? "").replace(/,/g, "")) || 0;
  return normalizeDecimalString(total - cost - kol, 2) ?? "0";
}

export function projectRevenueFormulaHint(): string {
  return "自動計算：專案總金額未稅 − 專案額外成本 − KOL費用未稅";
}

/** @deprecated 請改用 calc專案營收；保留別名避免舊引用炸掉 */
export function calc專案盈餘(
  _專案類型: string | null | undefined,
  專案總金額未稅: string | null | undefined,
  KOL費用未稅: string | null | undefined,
  專案成本: string | null | undefined = ""
): string {
  return calc專案營收(專案總金額未稅, 專案成本, KOL費用未稅);
}

/** @deprecated */
export function projectSurplusFormulaHint(_專案類型?: string | null): string {
  return projectRevenueFormulaHint();
}
