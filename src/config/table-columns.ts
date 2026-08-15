/**
 * 各 Table 的可用欄位定義
 * 供 ③ 使用者可見範圍 細選欄位（總覽指標亦在此，與其他分頁一致）
 */

import { OVERVIEW_KPI_KEYS, OVERVIEW_KPI_LABELS } from "@/config/overview-kpi";

/** 側欄／① 可見區塊順序（發票已併入財務分頁，不再獨立一區） */
export const SECTION_KEYS = ["overview", "master", "partners", "tasks", "payout", "finance"] as const;

/** ①「角色可見區塊」勾選用：不含總覽（總覽改由 ③ 依帳號設定子欄位／是否納入 tables） */
export const ROLE_SECTION_KEYS_FOR_UI = SECTION_KEYS.filter((k) => k !== "overview");

export const TABLE_LABELS: Record<string, string> = {
  overview: "總覽",
  master: "大總表",
  partners: "合作夥伴 / KOL",
  tasks: "任務",
  payout: "分潤表",
  finance: "財務",
  /** ③ 可見欄位用 key；側欄不單獨顯示 */
  invoices: "發票清冊（欄位）",
  paymentRecords: "付款記錄（欄位）",
  // 僅用於管理者 Dashboard 的設定分頁，不對應實際資料 Table
  visibility: "可見性與權限",
  audit: "異動紀錄",
};

/** 各 Table 的欄位 key → 顯示名稱 */
export const TABLE_COLUMNS: Record<string, Array<{ key: string; label: string }>> = {
  /** 總覽頂部指標（③ 可見欄位；非列級篩選） */
  overview: OVERVIEW_KPI_KEYS.map((key) => ({ key, label: OVERVIEW_KPI_LABELS[key] })),
  master: [
    { key: "專案ID", label: "專案ID" },
    { key: "專案名稱", label: "專案名稱" },
    { key: "專案狀態", label: "專案狀態" },
    /** 依財務「廠商付款日期／員工分潤日期」衍生，非大總表 DB 欄位 */
    { key: "款項進度", label: "款項進度" },
    /** 依發票清冊同 專案ID 匯總，非大總表 DB 欄位 */
    { key: "發票摘要", label: "發票摘要" },
    { key: "開案日期", label: "開案日期" },
    { key: "專案總金額未稅", label: "專案總金額未稅" },
    { key: "專案營收", label: "專案營收" },
    { key: "專案成本", label: "專案成本" },
    { key: "KOL費用未稅", label: "KOL費用未稅" },
    { key: "KOL名稱", label: "KOL名稱" },
    { key: "專案費用類型", label: "專案費用類型" },
    { key: "廠商名稱", label: "廠商名稱" },
    { key: "廠商預計付款日", label: "廠商預計付款日" },
    /** 模式 A（製作／活動） */
    { key: "專案引薦人", label: "專案引薦人（製作／活動）" },
    /** 模式 B（廣告業配、團購）；與「專案引薦人」分欄 */
    { key: "專案開發人", label: "專案開發人（廣告業配／團購）" },
    /** 分潤模式 A（製作案、活動案等） */
    { key: "專案BDPM", label: "專案BDPM（製作／活動）" },
    { key: "專案管理員", label: "專案管理員（製作／活動）" },
    { key: "執行管理員", label: "執行管理員（製作／活動）" },
    /** 分潤模式 B（廣告業配、團購）：人員欄位皆為專案手填 */
    { key: "經紀人", label: "經紀人（廣告業配／團購）" },
    { key: "主管", label: "主管（廣告業配／團購）" },
    { key: "KOL開發者", label: "KOL引薦人（廣告業配／團購）" },
  ],
  partners: [
    { key: "PartnerID", label: "PartnerID" },
    { key: "類別一", label: "類別一" },
    { key: "類別二", label: "類別二" },
    { key: "類別三", label: "類別三" },
    { key: "合作夥伴名稱", label: "合作夥伴名稱" },
    { key: "形象照", label: "形象照" },
    { key: "社群網站", label: "社群網站" },
    { key: "粉絲數", label: "粉絲數" },
    { key: "頻道｜節目名稱", label: "頻道｜節目名稱" },
    { key: "是否有經營 私域群", label: "是否有經營 私域群" },
    { key: "資料夾", label: "資料夾" },
    { key: "KOL開發者", label: "KOL開發者" },
    { key: "經銷約開始日", label: "經銷約開始日" },
    { key: "自來件分潤", label: "自來件分潤%數" },
    { key: "SDH開發分件分潤", label: "SDH開發件分潤%數" },
    { key: "經銷約結束日", label: "經銷約結束日" },
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
    { key: "任務類型", label: "任務類型" },
    { key: "任務負責人", label: "任務負責人" },
    { key: "建立者", label: "建立者" },
    { key: "備註", label: "備註" },
    { key: "到期日", label: "到期日" },
    { key: "開始時間", label: "開始時間" },
    { key: "完成時間", label: "完成時間" },
    { key: "任務完成", label: "任務完成" },
  ],
  payout: [
    { key: "專案ID", label: "專案ID" },
    { key: "專案名稱", label: "專案名稱" },
    { key: "專案總金額未稅", label: "專案總金額未稅" },
    { key: "專案營收", label: "專案營收" },
    { key: "廠商預計付款日", label: "廠商預計付款日" },
    { key: "廠商付款日期", label: "廠商付款日期" },
    { key: "分潤匯款日期", label: "分潤匯款日期" },
    { key: "分潤類型", label: "分潤類型" },
    { key: "分潤成數", label: "分潤成數" },
    { key: "分潤金額", label: "分潤金額" },
    { key: "領取人", label: "領取人" },
  ],
  finance: [
    { key: "專案ID", label: "專案ID" },
    { key: "專案名稱", label: "專案名稱" },
    { key: "專案總金額未稅", label: "專案總金額未稅" },
    { key: "專案成本", label: "專案成本" },
    { key: "專案實際成本", label: "專案實際成本" },
    { key: "專案分潤", label: "專案分潤" },
    { key: "專案利潤", label: "專案利潤" },
    { key: "專案利潤比", label: "專案利潤比" },
    { key: "發票號碼", label: "發票號碼" },
    { key: "廠商預計付款日", label: "廠商預計付款日" },
    { key: "廠商付款日期", label: "廠商付款日期" },
    { key: "員工分潤日期", label: "員工分潤日期" },
  ],
  paymentRecords: [
    { key: "發票號碼", label: "發票號碼" },
    { key: "付款日期", label: "付款日期" },
    { key: "付款專案", label: "付款專案（連結專案）" },
    { key: "付款對象", label: "付款對象" },
    { key: "付款金額", label: "付款金額" },
    { key: "備註", label: "備註" },
  ],
  invoices: [
    { key: "專案ID", label: "對應專案（可多選／可空白）" },
    { key: "發票號碼", label: "發票號碼" },
    { key: "發票日期", label: "發票日期" },
    { key: "收款對象", label: "收款對象" },
    { key: "發票金額含稅", label: "發票金額含稅" },
    { key: "廠商預計付款日", label: "廠商預計付款日" },
    { key: "廠商付款日期", label: "廠商實際付款日（入帳）" },
    { key: "備註", label: "備註" },
  ],
};

/**
 * ③ 可見欄位細選用的 table key（含「發票」欄位組，語意上屬財務模組）
 * ① 側欄僅使用 SECTION_KEYS，不含 invoices
 */
export const TABLE_KEYS = [...SECTION_KEYS, "invoices", "paymentRecords"] as const;
