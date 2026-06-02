/** KOL 合作夥伴表上的勾選欄位（DB 可能為 boolean 或歷史文字值） */
export const PARTNER_BOOLEAN_FIELD_KEYS = [
  "是否有經營 私域群",
  "廣告經銷夥伴",
  "節目製作夥伴",
  "課程製作夥伴",
] as const;

export type PartnerBooleanFieldKey = (typeof PARTNER_BOOLEAN_FIELD_KEYS)[number];

const PARTNER_BOOLEAN_FIELD_KEY_SET = new Set<string>(PARTNER_BOOLEAN_FIELD_KEYS);

export function isPartnerBooleanFieldKey(key: string): key is PartnerBooleanFieldKey {
  return PARTNER_BOOLEAN_FIELD_KEY_SET.has(key);
}

/** 將 DB／表單各種表示法統一為 boolean（避免 Boolean("false") === true） */
export function normalizePartnerBoolean(val: unknown): boolean {
  if (val === true || val === 1) return true;
  if (val === false || val === 0 || val === null || val === undefined) return false;
  const s = String(val).trim().toLowerCase();
  if (s === "" || s === "false" || s === "否" || s === "no" || s === "0" || s === "n") return false;
  if (s === "true" || s === "是" || s === "yes" || s === "1" || s === "y" || s === "✓" || s === "v") {
    return true;
  }
  return Boolean(val);
}
