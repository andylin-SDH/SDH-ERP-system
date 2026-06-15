/**
 * 分潤去重（system_config 歷史欄位；邏輯已固定為「同一人取最高成數」）
 * 實際儲存：system_config.key = payout_dedupe_rules（JSON，已不再使用手動規則）
 */

export type PayoutDedupeRule = { roles: string[]; keep: string };

export type PayoutDedupeRulesByMode = {
  mode_a: PayoutDedupeRule[];
  mode_b: PayoutDedupeRule[];
  /** 同一專案內，同一領取人僅保留一列（依 priority；在「成對規則」之後套用） */
  mode_a_merge_same_recipient?: boolean;
  mode_b_merge_same_recipient?: boolean;
  /** 數字越小越優先；未列出的分潤類型排在最後 */
  mode_a_priority?: string[];
  mode_b_priority?: string[];
};

export const DEFAULT_MODE_A_PRIORITY = ["專案BDPM", "專案引薦人", "專案管理員", "執行管理員"] as const;
export const DEFAULT_MODE_B_PRIORITY = ["專案開發人", "經紀人", "主管", "KOL開發者"] as const;

/** 與 lib/db/system-config 的 DEFAULT 一致 */
export const DEFAULT_PAYOUT_DEDUPE_RULES: PayoutDedupeRulesByMode = {
  mode_a: [],
  mode_b: [],
  mode_a_merge_same_recipient: false,
  mode_b_merge_same_recipient: false,
  mode_a_priority: [...DEFAULT_MODE_A_PRIORITY],
  mode_b_priority: [...DEFAULT_MODE_B_PRIORITY],
};
