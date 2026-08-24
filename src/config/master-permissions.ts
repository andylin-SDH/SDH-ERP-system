/**
 * 大總表欄位編輯權限
 * - 金額／KOL 費用／額外成本注記：登入可編輯者皆可改（異動寫入 master_edit_log）
 * - 「專案營收」DB 欄位現為自動計算的「專案盈餘」，儲存時由伺服器覆寫，不接受手填
 * - 「專案成本」DB 欄位現為「專案額外成本注記(與KOL共攤)」，僅備註數字、不參與盈餘／分潤計算
 * - 分潤成數：僅 role_permissions.master.update 所列角色（預設董事長、管理者）；一般由系統設定帶入
 */

export const MASTER_AMOUNT_FIELD_KEYS = [
  "專案總金額未稅",
  "專案成本",
  "KOL費用未稅",
  "專案營收",
] as const;

export const MASTER_PAYOUT_RATE_FIELD_KEYS = [
  "專案BDPM分潤成數",
  "專案引薦人分潤成數",
  "專案開發人分潤成數",
  "專案管理員分潤成數",
  "執行管理員分潤成數",
] as const;

/** @deprecated 請改用 MASTER_AMOUNT_FIELD_KEYS / MASTER_PAYOUT_RATE_FIELD_KEYS */
export const MASTER_NUMERIC_FIELD_KEYS = [
  ...MASTER_AMOUNT_FIELD_KEYS,
  ...MASTER_PAYOUT_RATE_FIELD_KEYS,
] as const;

export type MasterNumericFieldKey = (typeof MASTER_NUMERIC_FIELD_KEYS)[number];

export type RolePermissionsMaster = {
  create?: string[];
  update?: string[];
  delete?: string[];
};

/** 可否改分潤成數（金額已全面開放） */
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

/**
 * PATCH 時：無成數權限則保留 DB 既有分潤成數；金額欄一律允許寫入。
 */
export function applyMasterNumericFieldPolicy<T extends Record<string, unknown>>(
  body: T,
  existing: Record<string, unknown>,
  canEditRates: boolean
): T {
  if (canEditRates) return body;
  const next = { ...body };
  for (const key of MASTER_PAYOUT_RATE_FIELD_KEYS) {
    if (key in existing) {
      (next as Record<string, unknown>)[key] = existing[key];
    }
  }
  return next;
}
