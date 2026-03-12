/**
 * KOL / 合作夥伴審核狀態常數與經紀人可改欄位規則
 * 非董事長／管理者：除 KOL開發者 外其餘欄位皆可編輯（已核准或待審核建立者）
 */

export const PARTNER_STATUS = {
  PENDING: "待審核",
  APPROVED: "已核准",
  REJECTED: "已駁回",
} as const;

export type PartnerStatus = (typeof PARTNER_STATUS)[keyof typeof PARTNER_STATUS];

/**
 * 非管理者不可編輯的欄位（僅董事長／管理者可改）
 * 審核狀態、駁回理由僅能由管理者 PATCH
 */
export const PARTNER_AGENT_BLOCKED_KEYS = [
  "KOL開發者",
  "審核狀態",
  "駁回理由",
] as const;

/** 是否為經紀人不可自行修改的欄位 */
export function isPartnerAgentBlockedKey(key: string): boolean {
  return (PARTNER_AGENT_BLOCKED_KEYS as readonly string[]).includes(key);
}

export function normalizePartnerStatus(v: string | null | undefined): PartnerStatus {
  const s = String(v ?? "").trim();
  if (s === PARTNER_STATUS.PENDING || s === PARTNER_STATUS.REJECTED) return s;
  return PARTNER_STATUS.APPROVED;
}
