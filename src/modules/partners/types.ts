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
  經紀人?: string;
  /** KOL 開發者 */
  KOL開發者?: string;
  /** 主管（分潤模式 B 用） */
  主管?: string;
  /** 合約開始日期（可存 yyyy-MM-dd 或文字） */
  合約開始日期?: string;
  /** 自來件分潤（成數或文字，依業務約定） */
  自來件分潤?: string;
  /** SDH 開發分件分潤（成數或文字） */
  "SDH開發分件分潤"?: string;
  /** 經銷約起訖（可 yyyy-MM-dd 或自由文字） */
  經銷約開始日?: string;
  經銷約結束日?: string;
  廣告經銷夥伴?: boolean;
  節目製作夥伴?: boolean;
  課程製作夥伴?: boolean;
  Email?: string;
  分級?: string;
  /** 待審核 | 已核准 | 已駁回；主列表僅顯示已核准 */
  審核狀態?: string;
  /** 送出申請者 email */
  建立者?: string;
  /** 駁回時填寫 */
  駁回理由?: string;
  /** 已核准後再編輯並送審者的 email */
  待審核送出者?: string;
}
