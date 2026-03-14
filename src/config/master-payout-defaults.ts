/**
 * 大總表分潤成數預設值（新專案建立時帶入）
 * 模式 A（製作案、活動案）：專案BDPM、專案引薦人、專案管理員、執行管理員
 * 模式 B（廣告案）：專案引薦人、經紀人、主管、KOL開發者（後三者由 KOL 表帶出）
 */

export const MASTER_PAYOUT_DEFAULTS = {
  專案BDPM分潤成數: "10%",
  專案引薦人分潤成數: "2.5%",
  專案管理員分潤成數: "2.5%",
  執行管理員分潤成數: "2.5%",
  /** KOL 開發者分潤成數預設（與 partners.KOL開發者 對應；模式 A/B 皆用） */
  KOL開發者分潤成數: "2.5%",
  /** 模式 B（廣告案）專用 */
  經紀人分潤成數: "2.5%",
  主管分潤成數: "2.5%",
} as const;

/** 分潤模式 B 的專案類型（經紀人、主管、KOL開發者由 KOL 表帶出） */
export const PAYOUT_MODE_B_PROJECT_TYPES = ["廣告業配"] as const;

export function isPayoutModeB(projectType: string): boolean {
  return (PAYOUT_MODE_B_PROJECT_TYPES as readonly string[]).includes(projectType);
}
