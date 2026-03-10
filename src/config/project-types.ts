/**
 * 專案類型選項（用於下拉選單）
 */

export const PROJECT_TYPES = ["KOL開發", "廣告業配", "製作案", "活動案", "其他"] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];
