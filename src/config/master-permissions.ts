/**
 * 大總表欄位編輯權限
 * - 一般登入者：可改文字、日期、人員、狀態等
 * - 金額／營收／成本／分潤成數：僅 role_permissions.master.update 所列角色（預設董事長、管理者）
 */

export const MASTER_NUMERIC_FIELD_KEYS = [
  "專案總金額未稅",
  "專案成本",
  "KOL費用未稅",
  "專案營收",
  "專案BDPM分潤成數",
  "專案引薦人分潤成數",
  "專案開發人分潤成數",
  "專案管理員分潤成數",
  "執行管理員分潤成數",
] as const;

export type MasterNumericFieldKey = (typeof MASTER_NUMERIC_FIELD_KEYS)[number];

export type RolePermissionsMaster = {
  create?: string[];
  update?: string[];
  delete?: string[];
};

export function canEditMasterNumericFields(
  role: string,
  rolePermissions?: { master?: RolePermissionsMaster }
): boolean {
  const list = rolePermissions?.master?.update;
  if (!list?.length) {
    return role === "董事長" || role === "管理者";
  }
  return list.includes(role);
}

/** PATCH 時：無數字權限則保留 DB 既有金額／成數，忽略 request body */
export function applyMasterNumericFieldPolicy<T extends Record<string, unknown>>(
  body: T,
  existing: Record<string, unknown>,
  canEditNumbers: boolean
): T {
  if (canEditNumbers) return body;
  const next = { ...body };
  for (const key of MASTER_NUMERIC_FIELD_KEYS) {
    if (key in existing) {
      (next as Record<string, unknown>)[key] = existing[key];
    }
  }
  return next;
}
