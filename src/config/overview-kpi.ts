/**
 * 總覽頂部指標：key 與依角色預設（① 系統設定可覆寫；③ 使用者可覆寫）
 */

export const OVERVIEW_KPI_KEYS = [
  "projectCount",
  "pendingTasks",
  "totalRevenue",
  "grossMargin",
  "totalCost",
] as const;

export type OverviewKpiKey = (typeof OVERVIEW_KPI_KEYS)[number];

export const OVERVIEW_KPI_LABELS: Record<OverviewKpiKey, string> = {
  projectCount: "總專案數",
  pendingTasks: "待處理任務",
  totalRevenue: "總專案營收",
  grossMargin: "毛利率",
  totalCost: "總成本",
};

/** 靜態預設：各角色可見的總覽指標（與 role_visibility 分開設定） */
export const DEFAULT_OVERVIEW_KPI_BY_ROLE: Record<string, OverviewKpiKey[]> = {
  董事長: [...OVERVIEW_KPI_KEYS],
  管理者: [...OVERVIEW_KPI_KEYS],
  經紀人: [...OVERVIEW_KPI_KEYS],
  製作人: [...OVERVIEW_KPI_KEYS],
  會計: [...OVERVIEW_KPI_KEYS],
  行政: [...OVERVIEW_KPI_KEYS],
  KOL: [...OVERVIEW_KPI_KEYS],
};

export function getDefaultOverviewKpisForRole(role: string): OverviewKpiKey[] {
  return DEFAULT_OVERVIEW_KPI_BY_ROLE[role]?.length
    ? [...DEFAULT_OVERVIEW_KPI_BY_ROLE[role]]
    : [...OVERVIEW_KPI_KEYS];
}
