/**
 * KOL / 合作夥伴欄位編輯規則
 * 非董事長／管理者：除 KOL開發者 外其餘欄位皆可編輯
 */

/** 非管理者不可自行修改的欄位（僅董事長／管理者可改） */
export const PARTNER_AGENT_BLOCKED_KEYS = ["KOL開發者"] as const;

export function isPartnerAgentBlockedKey(key: string): boolean {
  return (PARTNER_AGENT_BLOCKED_KEYS as readonly string[]).includes(key);
}
