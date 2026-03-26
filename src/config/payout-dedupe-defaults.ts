/**
 * 分潤去重規則預設（前後端共用，不依賴 Supabase）
 */

export type PayoutDedupeRule = { roles: string[]; keep: string };

export type PayoutDedupeRulesByMode = { mode_a: PayoutDedupeRule[]; mode_b: PayoutDedupeRule[] };

/** 與 lib/db/system-config 的 DEFAULT 一致 */
export const DEFAULT_PAYOUT_DEDUPE_RULES: PayoutDedupeRulesByMode = {
  mode_a: [],
  mode_b: [{ roles: ["經紀人", "主管"], keep: "經紀人" }],
};
