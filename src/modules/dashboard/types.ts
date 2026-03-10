/**
 * Dashboard 模組型別
 * 各角色 Dashboard 的資料結構
 */

import type { Role } from "@/lib/types";

export interface DashboardConfig {
  role: Role;
  title: string;
  sheets: string[]; // 可存取的工作表
  filterByScope?: boolean; // 是否依 Scope 過濾
}
