import type { User } from "@/lib/types";

/** 員工後台可用角色（KOL 老師入口不在此列） */
export const EMPLOYEE_ERP_ROLES = new Set([
  "董事長",
  "管理者",
  "經紀人",
  "製作人",
  "會計",
  "行政",
]);

export function displayUserName(user: User): string {
  return (user.name && user.name.trim()) || user.email || "";
}

/** 角色為 KOL：僅能使用 /kol 老師 Dashboard，不得出現在員工後台選單或 API */
export function isKolExclusiveAccount(user: User): boolean {
  return String(user.role ?? "").trim() === "KOL";
}

/** 是否為 ERP 員工後台帳號 */
export function isEmployeeErpAccount(user: User): boolean {
  if (isKolExclusiveAccount(user)) return false;
  if (user.activeFlag === false) return false;
  const role = String(user.role ?? "").trim();
  return EMPLOYEE_ERP_ROLES.has(role);
}

/** 員工後台人員下拉（大總表、任務負責人等）：排除 KOL */
export function buildEmployeeUserNames(users: User[]): string[] {
  return [
    ...new Set(users.filter(isEmployeeErpAccount).map(displayUserName).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b, "zh-TW"));
}
