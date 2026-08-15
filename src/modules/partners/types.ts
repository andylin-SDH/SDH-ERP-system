/**
 * 合作夥伴 / KOL 模組型別
 * 對應大總表 Partners 工作表
 */

export interface PartnerRow {
  PartnerID?: string;
  類別一?: string;
  類別二?: string;
  類別三?: string;
  合作夥伴名稱?: string;
  社群網站?: string;
  粉絲數?: string;
  "頻道｜節目名稱"?: string;
  "是否有經營 私域群"?: boolean;
  資料夾?: string;
  /** KOL 開發者 */
  KOL開發者?: string;
  /** 主管（分潤模式 B 用） */
  主管?: string;
  /** 經銷約開始日（建議 yyyy-MM-dd） */
  經銷約開始日?: string;
  /** 自來件分潤（成數或文字，依業務約定） */
  自來件分潤?: string;
  /** SDH 開發分件分潤（成數或文字） */
  "SDH開發分件分潤"?: string;
  /** 經銷約結束日（建議 yyyy-MM-dd） */
  經銷約結束日?: string;
  廣告經銷夥伴?: boolean;
  節目製作夥伴?: boolean;
  課程製作夥伴?: boolean;
  Email?: string;
  分級?: string;
  /** 正方形形象照公開 URL */
  形象照?: string;
  /** 建立此 KOL 的使用者（姓名或 email） */
  建立者?: string;
  /** 最近一次儲存的使用者（姓名或 email） */
  最後更新者?: string;
  /** 最近一次儲存時間（ISO） */
  最後更新時間?: string;
  /** 軟刪時間；有值＝已封存 */
  deleted_at?: string | null;
  deleted_by?: string | null;
  delete_reason?: string | null;
}
