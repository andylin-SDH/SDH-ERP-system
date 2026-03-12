/**
 * 各 Table 的可用欄位定義
 * 與 ① 角色可見區塊 一致：master, partners, tasks, finance, invoices
 * 供 ③ 使用者可見範圍 細選欄位
 */

/** 與 ① 可見區塊 相同的區塊 key 順序 */
export const SECTION_KEYS = ["master", "partners", "tasks", "payout", "finance", "invoices"] as const;

export const TABLE_LABELS: Record<string, string> = {
  master: "大總表",
  partners: "合作夥伴 / KOL",
  tasks: "任務",
  payout: "分潤表",
  finance: "財務",
  invoices: "發票",
  // 僅用於管理者 Dashboard 的設定分頁，不對應實際資料 Table
  visibility: "可見性與權限",
};

/** 各 Table 的欄位 key → 顯示名稱 */
export const TABLE_COLUMNS: Record<string, Array<{ key: string; label: string }>> = {
  master: [
    { key: "專案ID", label: "專案ID" },
    { key: "專案名稱", label: "專案名稱" },
    { key: "專案狀態", label: "專案狀態" },
    { key: "開案日期", label: "開案日期" },
    { key: "專案總金額未稅", label: "專案總金額未稅" },
    { key: "專案營收", label: "專案營收" },
    { key: "專案成本", label: "專案成本" },
    { key: "KOL費用未稅", label: "KOL費用未稅" },
    { key: "KOL名稱", label: "KOL名稱" },
    { key: "專案費用類型", label: "專案費用類型" },
    { key: "廠商名稱", label: "廠商名稱" },
    { key: "專案BDPM", label: "專案BDPM" },
    { key: "專案引薦人", label: "專案引薦人" },
    { key: "專案管理員", label: "專案管理員" },
    { key: "執行管理員", label: "執行管理員" },
  ],
  partners: [
    { key: "PartnerID", label: "PartnerID" },
    { key: "類別一", label: "類別一" },
    { key: "類別二", label: "類別二" },
    { key: "類別三", label: "類別三" },
    { key: "合作夥伴名稱", label: "合作夥伴名稱" },
    { key: "社群網站", label: "社群網站" },
    { key: "粉絲數", label: "粉絲數" },
    { key: "頻道｜節目名稱", label: "頻道｜節目名稱" },
    { key: "是否有經營 私域群", label: "是否有經營 私域群" },
    { key: "資料夾", label: "資料夾" },
    { key: "經紀人", label: "經紀人" },
    { key: "KOL開發者", label: "KOL開發者" },
    { key: "廣告經銷夥伴", label: "廣告經銷夥伴" },
    { key: "節目製作夥伴", label: "節目製作夥伴" },
    { key: "課程製作夥伴", label: "課程製作夥伴" },
    { key: "Email", label: "Email" },
    { key: "分級", label: "分級" },
  ],
  tasks: [
    { key: "專案ID", label: "專案ID" },
    { key: "專案名稱", label: "專案名稱" },
    { key: "任務", label: "任務" },
    { key: "狀態", label: "狀態" },
    { key: "任務負責人", label: "任務負責人" },
    { key: "任務完成", label: "任務完成" },
  ],
  payout: [
    { key: "專案ID", label: "專案ID" },
    { key: "專案名稱", label: "專案名稱" },
    { key: "專案總金額未稅", label: "專案總金額未稅" },
    { key: "分潤類型", label: "分潤類型" },
    { key: "分潤成數", label: "分潤成數" },
    { key: "分潤金額", label: "分潤金額" },
    { key: "領取人", label: "領取人" },
  ],
  finance: [
    { key: "專案ID", label: "專案ID" },
    { key: "專案總金額未稅", label: "專案總金額未稅" },
    { key: "專案成本", label: "專案成本" },
    { key: "專案實際成本", label: "專案實際成本" },
    { key: "專案分潤", label: "專案分潤" },
    { key: "專案利潤", label: "專案利潤" },
    { key: "專案利潤比", label: "專案利潤比" },
    { key: "發票號碼", label: "發票號碼" },
    { key: "廠商付款狀態", label: "廠商付款狀態" },
    { key: "員工分潤狀態", label: "員工分潤狀態" },
  ],
  invoices: [
    { key: "專案ID", label: "專案ID" },
    { key: "發票號碼", label: "發票號碼" },
    { key: "發票日期", label: "發票日期" },
    { key: "發票金額未稅", label: "發票金額未稅" },
    { key: "發票金額含稅", label: "發票金額含稅" },
    { key: "發票稅金", label: "發票稅金" },
    { key: "廠商預計付款日", label: "廠商預計付款日" },
    { key: "廠商實付金額", label: "廠商實付金額" },
    { key: "廠商付款狀態", label: "廠商付款狀態" },
    { key: "廠商付款日期", label: "廠商付款日期" },
    { key: "備註", label: "備註" },
  ],
};

/** 與 ① 可見區塊 同步：用 SECTION_KEYS 作為 Table 列表（③ 可見欄位 與 ① 一致） */
export const TABLE_KEYS = [...SECTION_KEYS];
