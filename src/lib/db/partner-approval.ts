/**
 * KOL / 合作夥伴審核狀態常數與經紀人可改欄位白名單
 */

export const PARTNER_STATUS = {
  PENDING: "待審核",
  APPROVED: "已核准",
  REJECTED: "已駁回",
} as const;

export type PartnerStatus = (typeof PARTNER_STATUS)[keyof typeof PARTNER_STATUS];

/** 已核准後，經紀人僅可修改這些欄位（董事長不受限） */
export const PARTNER_AGENT_EDITABLE_KEYS = [
  "社群網站",
  "粉絲數",
  "頻道｜節目名稱",
  "資料夾",
  "是否有經營 私域群",
  "Email",
] as const;

/** 待審核／已駁回時，建立者可修改的欄位（可修改後再送審；不含審核狀態） */
export const PARTNER_AGENT_PENDING_EDITABLE_KEYS = [
  ...PARTNER_AGENT_EDITABLE_KEYS,
  "合作夥伴名稱",
  "類別一",
  "類別二",
  "類別三",
  "經紀人",
  "KOL開發者",
  "合約開始日期",
  "廣告經銷夥伴",
  "節目製作夥伴",
  "課程製作夥伴",
  "分級",
] as const;

export function normalizePartnerStatus(v: string | null | undefined): PartnerStatus {
  const s = String(v ?? "").trim();
  if (s === PARTNER_STATUS.PENDING || s === PARTNER_STATUS.REJECTED) return s;
  return PARTNER_STATUS.APPROVED;
}
