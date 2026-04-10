/**
 * 資料可見規則預設值
 * 當資料的「某欄位」符合登入者姓名或 Email 時，顯示該列（OR 邏輯）
 * 可由前端「資料可見規則」區塊修改，未設定時使用此預設
 */

export const VISIBILITY_RULES_DEFAULTS: Record<string, string[]> = {
  master: ["專案BDPM", "執行管理員", "專案引薦人", "專案開發人", "專案管理員"],
  /** 空陣列 = 不過濾，所有人可看全部 KOL */
  partners: [],
  tasks: ["任務負責人"],
  payout: ["領取人"],
};
