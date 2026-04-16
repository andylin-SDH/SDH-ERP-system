/**
 * 專案類型選項（用於下拉選單）
 */

export const PROJECT_TYPES = ["KOL開發", "廣告業配", "製作案", "活動案", "其他"] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

/**
 * 專案類型 → 專案成本 = 專案總金額未稅 × 比例（合約總額之比例）。
 * 例：製作案（製作按種類）預設成本為總額 70%。鍵名須與「專案類型」下拉選項完全一致。
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
