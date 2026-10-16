/**
 * 大總表分潤成數預設值（新專案建立時帶入）
 * 模式 A（製作案、活動案）：專案BDPM、專案引薦人、專案管理員、執行管理員
 * 模式 B（廣告案）：專案開發人、經紀人、主管、KOL引薦人（大總表手填；選 KOL 時可預填合作夥伴值）
 */

export const MASTER_PAYOUT_DEFAULTS = {
  專案BDPM分潤成數: "10%",
  專案引薦人分潤成數: "2.5%",
  專案管理員分潤成數: "2.5%",
  執行管理員分潤成數: "2.5%",
  /** 模式 B（廣告案）專用：與模式 A「專案引薦人分潤成數」分開設定 */
  專案開發人分潤成數: "2.5%",
  /** KOL 開發者分潤成數預設（與 partners.KOL開發者 對應；模式 A/B 皆用） */
  KOL開發者分潤成數: "2.5%",
  /** 模式 B（廣告案）專用 */
  經紀人分潤成數: "2.5%",
  主管分潤成數: "2.5%",
} as const;

/** 分潤模式 B 的專案類型（廣告業配、團購：人員欄位皆於大總表手填） */
export const PAYOUT_MODE_B_PROJECT_TYPES = ["廣告業配", "團購"] as const;

export function isPayoutModeB(projectType: string): boolean {
  const t = String(projectType ?? "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();
  return (PAYOUT_MODE_B_PROJECT_TYPES as readonly string[]).includes(t);
}

/** 這個日期之後新開的專案只留兩個分潤角色。舊專案此欄為空，沿用原來的角色。 */
export const TWO_ROLE_PAYOUT_SCHEME = "兩角色";

export function isTwoRolePayoutProject(row: { 分潤制度?: string | null } | null | undefined): boolean {
  return String(row?.分潤制度 ?? "").trim() === TWO_ROLE_PAYOUT_SCHEME;
}

/** 帳號沒填直屬主管時，新專案的主管用這個人。對應 users.姓名。 */
export const DEFAULT_DIRECT_SUPERVISOR_NAME = "Andy";

function samePersonName(a: string | null | undefined, b: string | null | undefined): boolean {
  return String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
}

/** Andy，以及有被別人填成直屬主管的人，都算公司裡的主管。 */
export function isCompanySupervisor(personName: string | null | undefined, assignedSupervisorNames: Iterable<string>): boolean {
  const name = String(personName ?? "").trim();
  if (!name) return false;
  if (samePersonName(name, DEFAULT_DIRECT_SUPERVISOR_NAME)) return true;
  for (const assigned of assignedSupervisorNames) {
    if (samePersonName(name, assigned)) return true;
  }
  return false;
}

/**
 * 主管自己開案：主管就是開案者，專案PM 7.5% 再加主管 2.5%，一共 10%。
 * 其他人有填直屬主管就用填的；沒填則是 Andy。
 */
export function projectSupervisorForOpener(
  personName: string | null | undefined,
  storedBoss: string | null | undefined,
  openerIsSupervisor: boolean
): string {
  const name = String(personName ?? "").trim();
  if (openerIsSupervisor && name) return name;
  const boss = String(storedBoss ?? "").trim();
  if (boss) return boss;
  return DEFAULT_DIRECT_SUPERVISOR_NAME;
}
