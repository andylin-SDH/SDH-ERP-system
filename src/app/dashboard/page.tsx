"use client";

import { Fragment, useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { User } from "@/lib/types";
import type { TaskRow } from "@/modules/tasks";
import type { PartnerRow } from "@/modules/partners";
import type { MasterRow } from "@/lib/db/master";
import type { InvoiceRow } from "@/modules/finance";
import type { PayoutRow } from "@/lib/db/payout";
import { applyDedupeRules } from "@/lib/payout-dedupe";
import { getSectionsForRole, isFullAccessRole, ROLE_VISIBILITY, ROLES } from "@/config/role-visibility";
import { PROJECT_TYPES } from "@/config/project-types";
import { MASTER_PAYOUT_DEFAULTS, isPayoutModeB } from "@/config/master-payout-defaults";
import { DEFAULT_PAYOUT_DEDUPE_RULES, type PayoutDedupeRulesByMode } from "@/config/payout-dedupe-defaults";
import { TABLE_KEYS, TABLE_LABELS, TABLE_COLUMNS } from "@/config/table-columns";
import {
  OVERVIEW_KPI_KEYS,
  OVERVIEW_KPI_LABELS,
  getDefaultOverviewKpisForRole,
  type OverviewKpiKey,
} from "@/config/overview-kpi";
import { SocialLinkIcons } from "@/components/SocialLinkIcons";
import { PARTNER_STATUS, isPartnerAgentBlockedKey } from "@/lib/db/partner-approval";

/** 安全解析 Response：空 body 或非 JSON 時回傳 {}，避免 "Unexpected end of JSON input" */
async function safeResJson(r: Response): Promise<Record<string, unknown>> {
  const text = await r.text();
  if (!text.trim()) return {};
  try {
    return (JSON.parse(text) as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

/** 專案營收 = 專案總金額未稅 - 專案成本 - KOL費用未稅 */
function calc專案營收(總金額: string, 成本: string, kol費用: string): string {
  const a = Number(總金額) || 0;
  const b = Number(成本) || 0;
  const c = Number(kol費用) || 0;
  return String(a - b - c);
}

/** 分潤表欄位顯示順序（所有人一致）：分潤金額 → 分潤成數、專案名稱 → 其餘 */
const PAYOUT_DISPLAY_ORDER = [
  "分潤金額",
  "分潤成數",
  "專案名稱",
  "專案ID",
  "專案預計匯款日",
  "專案實際入帳日期",
  "分潤匯款日期",
  "專案營收",
  "專案總金額未稅",
  "分潤類型",
  "領取人",
] as const;

function sortPayoutColumnsForDisplay(cols: string[]): string[] {
  return [...cols].sort((a, b) => {
    const ia = PAYOUT_DISPLAY_ORDER.indexOf(a as (typeof PAYOUT_DISPLAY_ORDER)[number]);
    const ib = PAYOUT_DISPLAY_ORDER.indexOf(b as (typeof PAYOUT_DISPLAY_ORDER)[number]);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });
}

const RENDER_CHUNK_SIZE = 120;

/** 金額顯示用（數字型態，千分位） */
function formatAmount(v: string | null | undefined): string {
  if (v == null || String(v).trim() === "") return "—";
  const n = Number(String(v).replace(/,/g, ""));
  if (Number.isNaN(n)) return String(v);
  return n.toLocaleString("zh-TW");
}

function parseNumericField(v: string | null | undefined): number {
  if (v == null || String(v).trim() === "") return 0;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function masterRowRevenue(row: MasterRow): number {
  const r = row.專案營收;
  if (r != null && String(r).trim() !== "") return parseNumericField(r);
  return parseNumericField(calc專案營收(row.專案總金額未稅 ?? "", row.專案成本 ?? "", row.KOL費用未稅 ?? ""));
}

function masterRowCostSum(row: MasterRow): number {
  return parseNumericField(row.專案成本) + parseNumericField(row.KOL費用未稅);
}

/** 產生專案ID：SDH-YYYYMMDD-HHmmss-XX（XX 為 2 碼隨機，避免同秒多筆衝突） */
function generateProjectId(): string {
  const now = new Date();
  const Y = now.getFullYear();
  const M = String(now.getMonth() + 1).padStart(2, "0");
  const D = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 4).toUpperCase();
  return `SDH-${Y}${M}${D}-${h}${m}${s}-${rand}`;
}

const OVERVIEW_SCOPE_STORAGE_KEY = "sdh-dashboard-overview-scope";

/** 大總表上與「這個人與專案有關」可能對得上的欄位（姓名／Email 需與 Users 一致） */
const MASTER_RELATED_FIELD_KEYS = ["專案BDPM", "專案引薦人", "專案管理員", "執行管理員", "KOL名稱"] as const;

function fieldMatchesUser(val: string | null | undefined, userName: string, userEmail: string): boolean {
  const v = String(val ?? "").trim();
  if (!v) return false;
  return v === userName || v === userEmail;
}

function isMasterRowRelatedToUser(row: MasterRow, userName: string, userEmail: string, projectIdsFromMyTasks: Set<string>): boolean {
  if (!userName && !userEmail) return false;
  for (const key of MASTER_RELATED_FIELD_KEYS) {
    const cell = row[key as keyof MasterRow] as string | null | undefined;
    if (fieldMatchesUser(cell, userName, userEmail)) return true;
  }
  const pid = String(row.專案ID ?? "").trim();
  return Boolean(pid && projectIdsFromMyTasks.has(pid));
}

/** 進行中：排除明顯已結案／完成狀態（空狀態視為進行中） */
function isProjectInProgress(專案狀態: string | null | undefined): boolean {
  const s = String(專案狀態 ?? "").trim();
  if (!s) return true;
  const lower = s.toLowerCase();
  if (lower.includes("結案") || lower.includes("完結") || lower === "完成" || lower.includes("已結束")) return false;
  return true;
}

function taskAssigneeIsUser(t: TaskRow, userName: string, userEmail: string): boolean {
  const a = String(t.任務負責人 ?? "").trim();
  if (!a) return false;
  return a === userName || a === userEmail;
}

export default function DashboardPage() {
  const [me, setMe] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [masterList, setMasterList] = useState<MasterRow[]>([]);
  const [showCreateMaster, setShowCreateMaster] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState({
    專案ID: "",
    專案名稱: "",
    專案類型: "",
    專案狀態: "",
    狀態確認日期: "",
    開案日期: "",
    專案總金額未稅: "",
    專案營收: "",
    專案成本: "",
    KOL費用未稅: "",
    KOL名稱: "",
    專案費用類型: "",
    廠商名稱: "",
    專案資料夾: "",
    專案BDPM: "",
    專案BDPM分潤成數: "",
    專案引薦人: "",
    專案引薦人分潤成數: "",
    專案管理員: "",
    專案管理員分潤成數: "",
    執行管理員: "",
    執行管理員分潤成數: "",
    專案內容: "",
    備註: "",
  });
  const [selectedMaster, setSelectedMaster] = useState<MasterRow | null>(null);
  const [isEditingMaster, setIsEditingMaster] = useState(false);
  const [savingMaster, setSavingMaster] = useState(false);
  const [saveMasterError, setSaveMasterError] = useState<string | null>(null);
  const [editMasterForm, setEditMasterForm] = useState(() => ({
    專案名稱: "",
    專案類型: "",
    專案狀態: "",
    狀態確認日期: "",
    開案日期: "",
    專案資料夾: "",
    專案總金額未稅: "",
    專案營收: "",
    專案成本: "",
    KOL費用未稅: "",
    專案費用類型: "",
    KOL名稱: "",
    廠商名稱: "",
    專案BDPM: "",
    專案BDPM分潤成數: "",
    專案引薦人: "",
    專案引薦人分潤成數: "",
    專案管理員: "",
    專案管理員分潤成數: "",
    執行管理員: "",
    執行管理員分潤成數: "",
    專案內容: "",
    備註: "",
  }));
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [partners, setPartners] = useState<PartnerRow[]>([]);
  /** GET /api/partners 回傳的 partnersError：精確欄位查詢失敗或 DB 結構不符 */
  const [partnersLoadError, setPartnersLoadError] = useState<string | null>(null);
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
  const [addingTaskFor, setAddingTaskFor] = useState<string | null>(null);
  const [newTaskForm, setNewTaskForm] = useState({ 任務名稱: "", 任務狀態: "", 任務負責人: "" });
  const [addingTask, setAddingTask] = useState(false);
  const [addTaskError, setAddTaskError] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<TaskRow | null>(null);
  const [editTaskForm, setEditTaskForm] = useState({ 任務名稱: "", 任務狀態: "", 任務負責人: "", 任務完成: false });
  const [savingTask, setSavingTask] = useState(false);
  const [saveTaskError, setSaveTaskError] = useState<string | null>(null);
  const [remindingTaskId, setRemindingTaskId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedUserForVisibility, setSelectedUserForVisibility] = useState<User | null>(null);
  const [visibilityTables, setVisibilityTables] = useState<string[]>([]);
  /** null = 依①角色總覽指標；陣列 = 此帳號專用 */
  const [visibilityOverviewKpis, setVisibilityOverviewKpis] = useState<string[] | null>(null);
  const [visibilityColumns, setVisibilityColumns] = useState<Record<string, string[]>>({});
  const [savingVisibility, setSavingVisibility] = useState(false);
  const [visibilityError, setVisibilityError] = useState<string | null>(null);
  const [editUserForm, setEditUserForm] = useState<{ name: string; role: string; dept: string; scope: string; password: string }>({ name: "", role: "", dept: "", scope: "", password: "" });
  const [savingUser, setSavingUser] = useState(false);
  const [editUserError, setEditUserError] = useState<string | null>(null);
  const [myVisibility, setMyVisibility] = useState<{
    tables: string[];
    columns: Record<string, string[]>;
    /** null = 依①角色總覽指標設定 */
    overview_kpis?: string[] | null;
  } | null>(null);
  /** Dashboard 分頁目前排序（拖曳用），null 代表沿用預設順序 */
  const [tabOrder, setTabOrder] = useState<string[] | null>(null);
  const [draggingTab, setDraggingTab] = useState<string | null>(null);
  /** 董事長：總覽為「與我有關」或「全公司」（其餘角色僅與我有關） */
  const [overviewScope, setOverviewScopeState] = useState<"mine" | "company">("mine");
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [createUserForm, setCreateUserForm] = useState({ email: "", name: "", password: "", role: "經紀人", dept: "", scope: "" });
  const [creatingUser, setCreatingUser] = useState(false);
  const [createUserError, setCreateUserError] = useState<string | null>(null);
  const [showCreatePartner, setShowCreatePartner] = useState(false);
  const [createPartnerForm, setCreatePartnerForm] = useState<{
    PartnerID: string;
    類別一: string;
    類別二: string;
    類別三: string;
    合作夥伴名稱: string;
    社群網站: string;
    粉絲數: string;
    "頻道｜節目名稱": string;
    "是否有經營 私域群": boolean;
    資料夾: string;
    經紀人: string;
    KOL開發者: string;
    主管: string;
    合約開始日期: string;
    廣告經銷夥伴: boolean;
    節目製作夥伴: boolean;
    課程製作夥伴: boolean;
    Email: string;
    分級: string;
  }>({
    PartnerID: "",
    類別一: "",
    類別二: "",
    類別三: "",
    合作夥伴名稱: "",
    社群網站: "",
    粉絲數: "",
    "頻道｜節目名稱": "",
    "是否有經營 私域群": false,
    資料夾: "",
    經紀人: "",
    KOL開發者: "",
    主管: "",
    合約開始日期: "",
    廣告經銷夥伴: false,
    節目製作夥伴: false,
    課程製作夥伴: false,
    Email: "",
    分級: "",
  });
  const [creatingPartner, setCreatingPartner] = useState(false);
  const [createPartnerError, setCreatePartnerError] = useState<string | null>(null);
  const [expandedPartnerId, setExpandedPartnerId] = useState<string | null>(null);
  /** 分潤表卡片：展開更多詳情的 key（row.id 或 fallback 索引） */
  const [expandedPayoutCardKey, setExpandedPayoutCardKey] = useState<string | null>(null);
  const [showEditPartner, setShowEditPartner] = useState(false);
  const [editPartnerForm, setEditPartnerForm] = useState<{
    PartnerID: string;
    類別一: string;
    類別二: string;
    類別三: string;
    合作夥伴名稱: string;
    社群網站: string;
    粉絲數: string;
    "頻道｜節目名稱": string;
    "是否有經營 私域群": boolean;
    資料夾: string;
    經紀人: string;
    KOL開發者: string;
    主管: string;
    合約開始日期: string;
    廣告經銷夥伴: boolean;
    節目製作夥伴: boolean;
    課程製作夥伴: boolean;
    Email: string;
    分級: string;
  }>({
    PartnerID: "",
    類別一: "",
    類別二: "",
    類別三: "",
    合作夥伴名稱: "",
    社群網站: "",
    粉絲數: "",
    "頻道｜節目名稱": "",
    "是否有經營 私域群": false,
    資料夾: "",
    經紀人: "",
    KOL開發者: "",
    主管: "",
    合約開始日期: "",
    廣告經銷夥伴: false,
    節目製作夥伴: false,
    課程製作夥伴: false,
    Email: "",
    分級: "",
  });
  const [savingPartner, setSavingPartner] = useState(false);
  const [partnerEditError, setPartnerEditError] = useState<string | null>(null);
  const [refreshingFollowers, setRefreshingFollowers] = useState(false);
  const [refreshFollowersMessage, setRefreshFollowersMessage] = useState<string | null>(null);
  /** 合作夥伴主列表：已上架 | 待審核 */
  const [partnersTab, setPartnersTab] = useState<"approved" | "pending">("approved");
  const [partnersPending, setPartnersPending] = useState<PartnerRow[]>([]);
  /** 已上架 KOL 的變更申請（不從主列表消失） */
  const [partnerChangeRequests, setPartnerChangeRequests] = useState<
    Array<{
      id: string;
      PartnerID: string;
      變更內容: Record<string, unknown>;
      變更前快照?: Record<string, unknown>;
      審核狀態: string;
      建立者?: string;
      駁回理由?: string;
      created_at?: string;
    }>
  >([]);
  const [partnersPendingLoading, setPartnersPendingLoading] = useState(false);
  const [showChangeRequestDiff, setShowChangeRequestDiff] = useState<{
    id: string;
    PartnerID: string;
    變更內容: Record<string, unknown>;
    變更前快照?: Record<string, unknown>;
    審核狀態: string;
    駁回理由?: string;
  } | null>(null);
  /** 編輯 Modal 開啟時的來源列（判斷經紀人可否儲存） */
  const [editingPartnerSource, setEditingPartnerSource] = useState<PartnerRow | null>(null);
  /** 新增／編輯 KOL 表單：自動 PartnerID、類別與 KOL開發者下拉 */
  const [partnerFormOptions, setPartnerFormOptions] = useState<{
    nextPartnerId: string;
    categories: { 類別一: string[]; 類別二: string[]; 類別三: string[] };
    users: { name: string; email: string }[];
  } | null>(null);
  const [visibilityRules, setVisibilityRules] = useState<Record<string, string[]>>({});
  const [savingVisibilityRules, setSavingVisibilityRules] = useState(false);
  const [visibilityRulesError, setVisibilityRulesError] = useState<string | null>(null);
  const [systemConfig, setSystemConfig] = useState<{
    master_payout_defaults: Record<string, string>;
    project_types: string[];
    role_visibility: Record<string, { sections: string[] }>;
    roles?: string[];
    payout_dedupe_rules?: PayoutDedupeRulesByMode;
    overview_kpi_by_role?: Record<string, string[]>;
  } | null>(null);
  const [newRoleName, setNewRoleName] = useState("");
  const [savingConfig, setSavingConfig] = useState<string | null>(null);
  const [savingRoles, setSavingRoles] = useState(false);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [finance, setFinance] = useState<Record<string, string | undefined>[]>([]);
  const [payoutList, setPayoutList] = useState<PayoutRow[]>([]);
  /** Dashboard 分頁搜尋關鍵字（各區塊獨立） */
  const [masterSearch, setMasterSearch] = useState("");
  const [partnersSearch, setPartnersSearch] = useState("");
  const [tasksSearch, setTasksSearch] = useState("");
  const [payoutSearch, setPayoutSearch] = useState("");
  const [financeSearch, setFinanceSearch] = useState("");
  const [invoicesSearch, setInvoicesSearch] = useState("");
  /** 大資料量時分段渲染，降低首屏與互動卡頓 */
  const [masterRenderCount, setMasterRenderCount] = useState(RENDER_CHUNK_SIZE);
  const [partnersRenderCount, setPartnersRenderCount] = useState(RENDER_CHUNK_SIZE);
  const [payoutRenderCount, setPayoutRenderCount] = useState(RENDER_CHUNK_SIZE);
  const [tasksRenderCount, setTasksRenderCount] = useState(RENDER_CHUNK_SIZE);
  const [financeRenderCount, setFinanceRenderCount] = useState(RENDER_CHUNK_SIZE);
  const [invoicesRenderCount, setInvoicesRenderCount] = useState(RENDER_CHUNK_SIZE);
  /** 讓輸入先回應，再延後套用篩選，降低卡頓 */
  const deferredMasterSearch = useDeferredValue(masterSearch);
  const deferredPartnersSearch = useDeferredValue(partnersSearch);
  const deferredTasksSearch = useDeferredValue(tasksSearch);
  const deferredPayoutSearch = useDeferredValue(payoutSearch);
  const deferredFinanceSearch = useDeferredValue(financeSearch);
  const deferredInvoicesSearch = useDeferredValue(invoicesSearch);

  const payoutDefaults = useMemo(
    () => systemConfig?.master_payout_defaults ?? MASTER_PAYOUT_DEFAULTS,
    [systemConfig]
  );
  const projectTypesOptions = useMemo(
    () => systemConfig?.project_types ?? [...PROJECT_TYPES],
    [systemConfig]
  );
  /** 欄位標籤快取：避免 render 期間大量 .find() */
  const tableColumnLabels = useMemo(() => {
    const byTable: Record<string, Record<string, string>> = {};
    for (const [tableKey, cols] of Object.entries(TABLE_COLUMNS)) {
      byTable[tableKey] = Object.fromEntries(cols.map((c) => [c.key, c.label]));
    }
    return byTable;
  }, []);

  /** 分潤規則：分模式 A/B；與後端預設合併，避免只更新單一欄位時遺失 mode_a / mode_b */
  const payoutDedupeRules = useMemo(() => {
    const raw = systemConfig?.payout_dedupe_rules;
    if (!raw) return DEFAULT_PAYOUT_DEDUPE_RULES;
    return {
      mode_a: raw.mode_a ?? DEFAULT_PAYOUT_DEDUPE_RULES.mode_a,
      mode_b: raw.mode_b ?? DEFAULT_PAYOUT_DEDUPE_RULES.mode_b,
      mode_a_merge_same_recipient: raw.mode_a_merge_same_recipient ?? DEFAULT_PAYOUT_DEDUPE_RULES.mode_a_merge_same_recipient,
      mode_b_merge_same_recipient: raw.mode_b_merge_same_recipient ?? DEFAULT_PAYOUT_DEDUPE_RULES.mode_b_merge_same_recipient,
      mode_a_priority: raw.mode_a_priority?.length ? raw.mode_a_priority : DEFAULT_PAYOUT_DEDUPE_RULES.mode_a_priority,
      mode_b_priority: raw.mode_b_priority?.length ? raw.mode_b_priority : DEFAULT_PAYOUT_DEDUPE_RULES.mode_b_priority,
    };
  }, [systemConfig?.payout_dedupe_rules]);

  /** 角色列表：優先使用系統設定（DB），無則用 config 預設；與「角色管理」「新增使用者」下拉一致 */
  const displayRoles = useMemo(
    () => (systemConfig?.roles?.length ? systemConfig.roles : [...ROLES]),
    [systemConfig?.roles]
  );

  /** 專案權限設定：預設 create = 所有角色；update/delete = 董事長 + 管理者，可在 UI 調整 */
  const rolePermissions = useMemo(() => {
    const roles = displayRoles;
    const defaultCreate = roles;
    const defaultAdmin = roles.filter((r) => r === "董事長" || r === "管理者");
    const defaultUpdateDelete = defaultAdmin.length ? defaultAdmin : roles;
    const fromConfig = (systemConfig as unknown as { role_permissions?: { master?: { create?: string[]; update?: string[]; delete?: string[] } } })?.role_permissions;
    const masterPerms = fromConfig?.master ?? {};
    const norm = (arr: string[] | undefined, fallback: string[]) =>
      (arr && arr.length ? arr : fallback).filter((r) => roles.includes(r));
    return {
      master: {
        create: norm(masterPerms.create, defaultCreate),
        update: norm(masterPerms.update, defaultUpdateDelete),
        delete: norm(masterPerms.delete, defaultUpdateDelete),
      },
    };
  }, [displayRoles, systemConfig]);

  /** 使用者姓名列表（對應 Users；用於分潤模式 A/B 的專案BDPM、專案引薦人、專案管理員、執行管理員 下拉選單） */
  const userNames = useMemo(
    () => [...new Set(users.map((u) => (u.name && u.name.trim()) || u.email || "").filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-TW")),
    [users]
  );

  /** 董事長／管理者可為使用者設定可見範圍、調整系統設定 */
  const canEditVisibility = me && ["董事長", "管理者"].includes(me.role);

  const fetchPartnerFormOptions = useCallback(async () => {
    try {
      const res = await fetch("/api/partners/form-options", { cache: "no-store" });
      const data = (await safeResJson(res)) as {
        ok?: boolean;
        nextPartnerId?: string;
        categories?: { 類別一: string[]; 類別二: string[]; 類別三: string[] };
        users?: { name: string; email: string }[];
      };
      if (res.ok && data.ok && data.nextPartnerId && data.categories && data.users) {
        setPartnerFormOptions({
          nextPartnerId: data.nextPartnerId,
          categories: data.categories,
          users: data.users,
        });
        return data;
      }
    } catch {
      /* ignore */
    }
    return null;
  }, []);

  const fetchPartnersPending = useCallback(async () => {
    setPartnersPendingLoading(true);
    try {
      const res = await fetch("/api/partners?pending=1", { cache: "no-store" });
      const data = (await safeResJson(res)) as {
        partners?: PartnerRow[];
        changeRequests?: Array<{
          id: string;
          PartnerID: string;
          變更內容: Record<string, unknown>;
          變更前快照?: Record<string, unknown>;
          審核狀態: string;
          建立者?: string;
          駁回理由?: string;
          created_at?: string;
        }>;
      };
      if (res.ok && Array.isArray(data.partners)) setPartnersPending(data.partners);
      if (res.ok && Array.isArray(data.changeRequests)) setPartnerChangeRequests(data.changeRequests);
      else if (res.ok) setPartnerChangeRequests([]);
    } finally {
      setPartnersPendingLoading(false);
    }
  }, []);

  /**
   * 是否顯示儲存／可編輯欄位
   * - 已核准：任一同登入者可編輯（除 KOL開發者）
   * - 待審核／已駁回：僅建立者可編輯
   */
  const canPartnerAgentSave = useMemo(() => {
    if (!me || !editingPartnerSource) return false;
    const row = editingPartnerSource;
    const status = row.審核狀態 ?? PARTNER_STATUS.APPROVED;
    if (status === PARTNER_STATUS.APPROVED) return true;
    const meEmail = me.email.trim().toLowerCase();
    const creator = String(row.建立者 ?? "").trim().toLowerCase();
    if ((status === PARTNER_STATUS.PENDING || status === PARTNER_STATUS.REJECTED) && creator === meEmail) return true;
    return false;
  }, [me, editingPartnerSource]);

  /** 編輯 Modal 開啟時載入類別／Users 下拉選項 */
  useEffect(() => {
    if (showEditPartner) fetchPartnerFormOptions();
  }, [showEditPartner, fetchPartnerFormOptions]);

  /** 非董事長／管理者：除 KOL開發者（及審核欄位）外皆可編輯 */
  const partnerFieldEditable = useCallback(
    (key: string) => {
      if (canEditVisibility) return true;
      if (!canPartnerAgentSave || !editingPartnerSource) return false;
      if (isPartnerAgentBlockedKey(key)) return false;
      return true;
    },
    [canEditVisibility, canPartnerAgentSave, editingPartnerSource]
  );

  /** 目前登入者可見的資料區塊（③ 自訂 visibility 優先，否則 ① DB 角色可見區塊，最後 fallback 靜態 config） */
  const visibleSections = useMemo(() => {
    if (!me) return [];
    const defaultSecs = getSectionsForRole(me.role);
    let base: string[];
    if (myVisibility?.tables?.length) {
      /** ③ 自訂區塊清單仍補上總覽（與①相同），否則側欄會缺「總覽」分頁 */
      base = [...myVisibility.tables];
    } else {
      const fromDb = systemConfig?.role_visibility?.[me.role]?.sections;
      base = fromDb && fromDb.length > 0 ? [...fromDb] : [...defaultSecs];
    }
    /** 靜態角色預設含總覽時，一律補上，避免舊 DB／舊③ 清單漏列 */
    if (defaultSecs.includes("overview") && !base.includes("overview")) return ["overview", ...base];
    return base;
  }, [me, myVisibility, systemConfig]);

  /** Dashboard 分頁列表：一般使用者只有資料區塊；董事長/管理者多一個「可見性與權限」設定分頁；若有自訂排序則優先使用 */
  const tabSections = useMemo(() => {
    if (!me) return [];
    if (!visibleSections.length) return canEditVisibility ? ["visibility"] : [];
    const base = canEditVisibility ? (["visibility", ...visibleSections] as string[]) : visibleSections;
    if (!tabOrder || tabOrder.length === 0) return base;
    // 依照 tabOrder 排序，過濾掉已不存在的 key，並補上新增的 key
    const setBase = new Set(base);
    const ordered = tabOrder.filter((k) => setBase.has(k));
    const rest = base.filter((k) => !ordered.includes(k));
    const merged = [...ordered, ...rest];
    /** 總覽固定緊接在「可見性與權限」之後（管理者），或置於資料分頁最前，方便回到總覽 */
    if (merged.includes("overview")) {
      const without = merged.filter((k) => k !== "overview");
      const visIdx = without.indexOf("visibility");
      if (visIdx !== -1) {
        return [...without.slice(0, visIdx + 1), "overview", ...without.slice(visIdx + 1)];
      }
      return ["overview", ...without];
    }
    return merged;
  }, [me, visibleSections, canEditVisibility, tabOrder]);

  /** 目前選取的區塊（分頁）：預設為 visibleSections 第 1 個 */
  const [activeSection, setActiveSection] = useState<string | null>(null);

  useEffect(() => {
    if (!me) {
      setActiveSection(null);
      return;
    }
    setActiveSection((prev) => {
      // 管理者專屬的「可見性與權限」分頁不在 visibleSections 中，需額外允許
      if (canEditVisibility && prev === "visibility") return "visibility";
      return prev && visibleSections.includes(prev) ? prev : visibleSections[0] ?? (canEditVisibility ? "visibility" : null);
    });
  }, [me, visibleSections, canEditVisibility]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(OVERVIEW_SCOPE_STORAGE_KEY);
      if (raw === "company" || raw === "mine") setOverviewScopeState(raw);
    } catch {
      /* ignore */
    }
  }, []);

  const setOverviewScope = useCallback((s: "mine" | "company") => {
    setOverviewScopeState(s);
    try {
      localStorage.setItem(OVERVIEW_SCOPE_STORAGE_KEY, s);
    } catch {
      /* ignore */
    }
  }, []);

  /** 取得某 Table 的可見欄位 key 列表（③ 使用者可見範圍） */
  const getVisibleColumnKeys = useCallback(
    (tableKey: string): string[] => {
      const cols = myVisibility?.columns?.[tableKey];
      if (!cols || cols.includes("*")) return (TABLE_COLUMNS[tableKey] ?? []).map((c) => c.key);
      return cols;
    },
    [myVisibility]
  );

  /** 文字搜尋：在指定欄位中做簡單子字串比對（大小寫不分） */
  const filterRowsBySearch = useCallback(
    <T extends Record<string, unknown>>(rows: T[], keys: string[], keyword: string): T[] => {
      const q = keyword.trim().toLowerCase();
      if (!q || !keys.length) return rows;
      return rows.filter((row) =>
        keys.some((k) => String((row as unknown as Record<string, unknown>)[k] ?? "").toLowerCase().includes(q))
      );
    },
    []
  );

  /** 列過濾：依 ② 資料可見規則，非 fullAccess 時只顯示 match_fields 符合登入者姓名/Email 的列；空字串視同未勾選 */
  const filterRowsByVisibility = useCallback(
    <T extends Record<string, unknown>>(rows: T[], tableKey: string): T[] => {
      if (!me || isFullAccessRole(me.role)) return rows;
      const raw = visibilityRules[tableKey] ?? [];
      const matchFields = (Array.isArray(raw) ? raw : []).map((f) => String(f).trim()).filter(Boolean);
      if (matchFields.length === 0) return rows;
      const uName = (me.name ?? "").trim();
      const uEmail = (me.email ?? "").trim();
      return rows.filter((row) => {
        for (const key of matchFields) {
          const val = String((row as unknown as Record<string, unknown>)[key] ?? "").trim();
          if (!val) continue;
          if (val === uName || val === uEmail) return true;
        }
        return false;
      });
    },
    [me, visibilityRules]
  );

  const filteredMasterList = useMemo(
    () => filterRowsByVisibility(masterList as unknown as Record<string, unknown>[], "master") as unknown as MasterRow[],
    [masterList, filterRowsByVisibility]
  );
  /** 合作夥伴 / KOL：與其他表相同，依 ② match_fields 篩列（未勾選 = 不篩；勾選經紀人 = 只顯示該欄位等於登入者姓名或帳號的列） */
  const filteredPartners = useMemo(
    () => filterRowsByVisibility(partners as unknown as Record<string, unknown>[], "partners") as unknown as PartnerRow[],
    [partners, filterRowsByVisibility]
  );
  const filteredTasks = useMemo(
    () => filterRowsByVisibility(tasks as unknown as Record<string, unknown>[], "tasks") as unknown as TaskRow[],
    [tasks, filterRowsByVisibility]
  );

  const overviewDirectorCompanyView = Boolean(me?.role === "董事長" && overviewScope === "company");

  const overviewMyTaskProjectIds = useMemo(() => {
    if (!me) return new Set<string>();
    const uName = (me.name ?? "").trim();
    const uEmail = (me.email ?? "").trim();
    const next = new Set<string>();
    for (const t of filteredTasks) {
      if (!taskAssigneeIsUser(t, uName, uEmail)) continue;
      const pid = String(t.專案ID ?? "").trim();
      if (pid) next.add(pid);
    }
    return next;
  }, [filteredTasks, me]);

  const overviewProjectRows = useMemo(() => {
    if (!me) return [];
    const uName = (me.name ?? "").trim();
    const uEmail = (me.email ?? "").trim();
    const inProgress = filteredMasterList.filter((row) => isProjectInProgress(row.專案狀態));
    if (overviewDirectorCompanyView) return inProgress.slice(0, 100);
    return inProgress
      .filter((row) => isMasterRowRelatedToUser(row, uName, uEmail, overviewMyTaskProjectIds))
      .slice(0, 100);
  }, [filteredMasterList, me, overviewDirectorCompanyView, overviewMyTaskProjectIds]);

  const overviewTaskRows = useMemo(() => {
    if (!me) return [];
    const uName = (me.name ?? "").trim();
    const uEmail = (me.email ?? "").trim();
    const open = filteredTasks.filter((t) => !t.任務完成);
    if (overviewDirectorCompanyView) return open.slice(0, 150);
    return open.filter((t) => taskAssigneeIsUser(t, uName, uEmail)).slice(0, 150);
  }, [filteredTasks, me, overviewDirectorCompanyView]);

  /** 總覽頂部指標：①③ 可設定可見 key */
  const visibleOverviewKpiKeys = useMemo((): OverviewKpiKey[] => {
    if (!me) return [];
    const fromRole =
      systemConfig?.overview_kpi_by_role?.[me.role] ?? getDefaultOverviewKpisForRole(me.role);
    const custom = myVisibility?.overview_kpis;
    if (custom === null || custom === undefined) {
      const fromR = fromRole.filter((k) => OVERVIEW_KPI_KEYS.includes(k as OverviewKpiKey));
      return (fromR.length ? fromR : [...OVERVIEW_KPI_KEYS]) as OverviewKpiKey[];
    }
    return custom.filter((k): k is OverviewKpiKey => OVERVIEW_KPI_KEYS.includes(k as OverviewKpiKey));
  }, [me, systemConfig?.overview_kpi_by_role, myVisibility?.overview_kpis]);

  const masterRowsForOverviewKpis = useMemo(() => {
    if (!me) return [];
    const uName = (me.name ?? "").trim();
    const uEmail = (me.email ?? "").trim();
    if (overviewDirectorCompanyView) return filteredMasterList;
    return filteredMasterList.filter((row) => isMasterRowRelatedToUser(row, uName, uEmail, overviewMyTaskProjectIds));
  }, [filteredMasterList, me, overviewDirectorCompanyView, overviewMyTaskProjectIds]);

  const overviewKpiMetrics = useMemo(() => {
    if (!me) return null;
    const uName = (me.name ?? "").trim();
    const uEmail = (me.email ?? "").trim();
    const inProgress = (rows: MasterRow[]) => rows.filter((row) => isProjectInProgress(row.專案狀態));
    const projectCount = overviewDirectorCompanyView
      ? inProgress(filteredMasterList).length
      : inProgress(filteredMasterList).filter((row) =>
          isMasterRowRelatedToUser(row, uName, uEmail, overviewMyTaskProjectIds)
        ).length;
    const pendingTasks = filteredTasks.filter(
      (t) => !t.任務完成 && taskAssigneeIsUser(t, uName, uEmail)
    ).length;
    let totalRev = 0;
    let totalCost = 0;
    for (const row of masterRowsForOverviewKpis) {
      totalRev += masterRowRevenue(row);
      totalCost += masterRowCostSum(row);
    }
    const grossMarginPct = totalRev > 0 ? ((totalRev - totalCost) / totalRev) * 100 : null;
    return { projectCount, pendingTasks, totalRevenue: totalRev, totalCost, grossMarginPct };
  }, [me, filteredMasterList, filteredTasks, overviewDirectorCompanyView, overviewMyTaskProjectIds, masterRowsForOverviewKpis]);

  const masterVisibleCols = useMemo(() => getVisibleColumnKeys("master"), [getVisibleColumnKeys]);
  const partnersVisibleCols = useMemo(() => getVisibleColumnKeys("partners"), [getVisibleColumnKeys]);
  const tasksVisibleCols = useMemo(() => getVisibleColumnKeys("tasks"), [getVisibleColumnKeys]);
  const filteredPayout = useMemo(
    () => filterRowsByVisibility(payoutList as unknown as Record<string, unknown>[], "payout") as unknown as PayoutRow[],
    [payoutList, filterRowsByVisibility]
  );
  const payoutVisibleCols = useMemo(() => getVisibleColumnKeys("payout"), [getVisibleColumnKeys]);
  /** 分潤表實際欄順序：與權限／可見欄位一致，但全角色統一為「分潤金額優先」 */
  const payoutColsForDisplay = useMemo(() => sortPayoutColumnsForDisplay(payoutVisibleCols), [payoutVisibleCols]);
  const financeVisibleCols = useMemo(() => getVisibleColumnKeys("finance"), [getVisibleColumnKeys]);
  const invoicesVisibleCols = useMemo(() => getVisibleColumnKeys("invoices"), [getVisibleColumnKeys]);

  /**
   * KOL 區塊主列表欄位（與 ③ 可見欄位交集）
   * 含「經紀人」方便對照 ② 篩選：該欄必須與登入者 Users.姓名 或 Users.帳號 完全一致才會留下該列
   */
  const partnerListCols = useMemo(
    () =>
      /** KOL開發者、合約開始日期不顯示在主列表，僅在新增/編輯 Modal 與展開詳情維護 */
      ["合作夥伴名稱", "社群網站", "粉絲數", "頻道｜節目名稱", "資料夾", "經紀人", "分級"].filter((k) =>
        partnersVisibleCols.includes(k)
      ),
    [partnersVisibleCols]
  );

  /** 套用關鍵字搜尋後的各 Table 資料 */
  const searchedMasterList = useMemo(
    () =>
      filterRowsBySearch(filteredMasterList as unknown as Record<string, unknown>[], masterVisibleCols, deferredMasterSearch) as unknown as MasterRow[],
    [filteredMasterList, masterVisibleCols, deferredMasterSearch, filterRowsBySearch]
  );
  const searchedPartners = useMemo(
    () =>
      filterRowsBySearch(filteredPartners as unknown as Record<string, unknown>[], partnerListCols, deferredPartnersSearch) as unknown as PartnerRow[],
    [filteredPartners, partnerListCols, deferredPartnersSearch, filterRowsBySearch]
  );
  const searchedTasks = useMemo(
    () =>
      filterRowsBySearch(filteredTasks as unknown as Record<string, unknown>[], tasksVisibleCols, deferredTasksSearch) as unknown as TaskRow[],
    [filteredTasks, tasksVisibleCols, deferredTasksSearch, filterRowsBySearch]
  );

  /** 分潤表：依 system_config 的 dedupe 規則在「顯示層」做一次去重（確保 UI 與規則永遠同步） */
  const masterTypeByProjectId = useMemo(() => {
    const m = new Map<string, string>();
    for (const row of masterList) {
      const pid = String(row.專案ID ?? "").trim();
      if (!pid) continue;
      m.set(pid, String(row.專案類型 ?? "").trim());
    }
    return m;
  }, [masterList]);

  const dedupedPayoutForDisplay = useMemo(() => {
    if (!filteredPayout.length) return filteredPayout;
    const anyPairwise =
      (payoutDedupeRules.mode_a?.length ?? 0) + (payoutDedupeRules.mode_b?.length ?? 0) > 0;
    if (!anyPairwise) return filteredPayout;

    const groupByPid = new Map<string, PayoutRow[]>();
    const pidOrder: string[] = [];
    for (const r of filteredPayout) {
      const pid = String(r.專案ID ?? "").trim();
      if (!pid) continue;
      if (!groupByPid.has(pid)) {
        groupByPid.set(pid, []);
        pidOrder.push(pid);
      }
      groupByPid.get(pid)!.push(r);
    }

    const out: PayoutRow[] = [];
    for (const pid of pidOrder) {
      const rows = groupByPid.get(pid) ?? [];
      const projectType = masterTypeByProjectId.get(pid) ?? "";
      const isModeB = isPayoutModeB(projectType);
      const rulesToApply = isModeB ? payoutDedupeRules.mode_b : payoutDedupeRules.mode_a;
      let work = rows;
      if (rulesToApply.length) work = applyDedupeRules(work, rulesToApply);
      out.push(...work);
    }
    return out;
  }, [filteredPayout, masterTypeByProjectId, payoutDedupeRules]);

  const searchedPayout = useMemo(
    () =>
      filterRowsBySearch(dedupedPayoutForDisplay as unknown as Record<string, unknown>[], payoutVisibleCols, deferredPayoutSearch) as unknown as PayoutRow[],
    [dedupedPayoutForDisplay, payoutVisibleCols, deferredPayoutSearch, filterRowsBySearch]
  );
  const searchedFinance = useMemo(
    () => filterRowsBySearch(finance as unknown as Record<string, unknown>[], financeVisibleCols, deferredFinanceSearch),
    [finance, financeVisibleCols, deferredFinanceSearch, filterRowsBySearch]
  );
  const searchedInvoices = useMemo(
    () => filterRowsBySearch(invoices as unknown as Record<string, unknown>[], invoicesVisibleCols, deferredInvoicesSearch),
    [invoices, invoicesVisibleCols, deferredInvoicesSearch, filterRowsBySearch]
  );
  const visibleMasterRows = useMemo(
    () => searchedMasterList.slice(0, masterRenderCount),
    [searchedMasterList, masterRenderCount]
  );
  const visiblePartnersRows = useMemo(
    () => searchedPartners.slice(0, partnersRenderCount),
    [searchedPartners, partnersRenderCount]
  );
  const visiblePayoutRows = useMemo(
    () => searchedPayout.slice(0, payoutRenderCount),
    [searchedPayout, payoutRenderCount]
  );
  const visibleTasksRows = useMemo(
    () => searchedTasks.slice(0, tasksRenderCount),
    [searchedTasks, tasksRenderCount]
  );
  const visibleFinanceRows = useMemo(
    () => searchedFinance.slice(0, financeRenderCount),
    [searchedFinance, financeRenderCount]
  );
  const visibleInvoicesRows = useMemo(
    () => searchedInvoices.slice(0, invoicesRenderCount),
    [searchedInvoices, invoicesRenderCount]
  );

  useEffect(() => {
    if (activeSection !== "master") return;
    setMasterRenderCount(RENDER_CHUNK_SIZE);
    if (searchedMasterList.length <= RENDER_CHUNK_SIZE) return;
    let timer: number | undefined;
    const tick = () => {
      setMasterRenderCount((prev) => {
        const next = Math.min(prev + RENDER_CHUNK_SIZE, searchedMasterList.length);
        if (next < searchedMasterList.length) timer = window.setTimeout(tick, 0);
        return next;
      });
    };
    timer = window.setTimeout(tick, 0);
    return () => { if (timer) window.clearTimeout(timer); };
  }, [activeSection, searchedMasterList.length]);

  useEffect(() => {
    if (activeSection !== "partners" || partnersTab !== "approved") return;
    setPartnersRenderCount(RENDER_CHUNK_SIZE);
    if (searchedPartners.length <= RENDER_CHUNK_SIZE) return;
    let timer: number | undefined;
    const tick = () => {
      setPartnersRenderCount((prev) => {
        const next = Math.min(prev + RENDER_CHUNK_SIZE, searchedPartners.length);
        if (next < searchedPartners.length) timer = window.setTimeout(tick, 0);
        return next;
      });
    };
    timer = window.setTimeout(tick, 0);
    return () => { if (timer) window.clearTimeout(timer); };
  }, [activeSection, partnersTab, searchedPartners.length]);

  useEffect(() => {
    if (activeSection !== "payout") return;
    setPayoutRenderCount(RENDER_CHUNK_SIZE);
    if (searchedPayout.length <= RENDER_CHUNK_SIZE) return;
    let timer: number | undefined;
    const tick = () => {
      setPayoutRenderCount((prev) => {
        const next = Math.min(prev + RENDER_CHUNK_SIZE, searchedPayout.length);
        if (next < searchedPayout.length) timer = window.setTimeout(tick, 0);
        return next;
      });
    };
    timer = window.setTimeout(tick, 0);
    return () => { if (timer) window.clearTimeout(timer); };
  }, [activeSection, searchedPayout.length]);
  useEffect(() => {
    if (activeSection !== "tasks") return;
    setTasksRenderCount(RENDER_CHUNK_SIZE);
    if (searchedTasks.length <= RENDER_CHUNK_SIZE) return;
    let timer: number | undefined;
    const tick = () => {
      setTasksRenderCount((prev) => {
        const next = Math.min(prev + RENDER_CHUNK_SIZE, searchedTasks.length);
        if (next < searchedTasks.length) timer = window.setTimeout(tick, 0);
        return next;
      });
    };
    timer = window.setTimeout(tick, 0);
    return () => { if (timer) window.clearTimeout(timer); };
  }, [activeSection, searchedTasks.length]);

  useEffect(() => {
    if (activeSection !== "finance") return;
    setFinanceRenderCount(RENDER_CHUNK_SIZE);
    if (searchedFinance.length <= RENDER_CHUNK_SIZE) return;
    let timer: number | undefined;
    const tick = () => {
      setFinanceRenderCount((prev) => {
        const next = Math.min(prev + RENDER_CHUNK_SIZE, searchedFinance.length);
        if (next < searchedFinance.length) timer = window.setTimeout(tick, 0);
        return next;
      });
    };
    timer = window.setTimeout(tick, 0);
    return () => { if (timer) window.clearTimeout(timer); };
  }, [activeSection, searchedFinance.length]);

  useEffect(() => {
    if (activeSection !== "invoices") return;
    setInvoicesRenderCount(RENDER_CHUNK_SIZE);
    if (searchedInvoices.length <= RENDER_CHUNK_SIZE) return;
    let timer: number | undefined;
    const tick = () => {
      setInvoicesRenderCount((prev) => {
        const next = Math.min(prev + RENDER_CHUNK_SIZE, searchedInvoices.length);
        if (next < searchedInvoices.length) timer = window.setTimeout(tick, 0);
        return next;
      });
    };
    timer = window.setTimeout(tick, 0);
    return () => { if (timer) window.clearTimeout(timer); };
  }, [activeSection, searchedInvoices.length]);

  useEffect(() => {
    // 切換選取專案時，重置編輯狀態並同步表單
    if (!selectedMaster) {
      setIsEditingMaster(false);
      setSaveMasterError(null);
      return;
    }
    setIsEditingMaster(false);
    setSaveMasterError(null);
    setEditMasterForm({
      專案名稱: selectedMaster.專案名稱 ?? "",
      專案類型: selectedMaster.專案類型 ?? "",
      專案狀態: selectedMaster.專案狀態 ?? "",
      狀態確認日期: selectedMaster.狀態確認日期 ?? "",
      開案日期: selectedMaster.開案日期 ?? "",
      專案資料夾: selectedMaster.專案資料夾 ?? "",
      專案總金額未稅: selectedMaster.專案總金額未稅 ?? "",
      專案成本: selectedMaster.專案成本 ?? "",
      KOL費用未稅: selectedMaster.KOL費用未稅 ?? "",
      專案營收: calc專案營收(
        selectedMaster.專案總金額未稅 ?? "",
        selectedMaster.專案成本 ?? "",
        selectedMaster.KOL費用未稅 ?? ""
      ),
      專案費用類型: selectedMaster.專案費用類型 ?? "",
      KOL名稱: selectedMaster.KOL名稱 ?? "",
      廠商名稱: selectedMaster.廠商名稱 ?? "",
      專案BDPM: selectedMaster.專案BDPM ?? "",
      專案BDPM分潤成數: selectedMaster.專案BDPM分潤成數 ?? "",
      專案引薦人: selectedMaster.專案引薦人 ?? "",
      專案引薦人分潤成數: selectedMaster.專案引薦人分潤成數 ?? "",
      專案管理員: selectedMaster.專案管理員 ?? "",
      專案管理員分潤成數: selectedMaster.專案管理員分潤成數 ?? "",
      執行管理員: selectedMaster.執行管理員 ?? "",
      執行管理員分潤成數: selectedMaster.執行管理員分潤成數 ?? "",
      專案內容: selectedMaster.專案內容 ?? "",
      備註: selectedMaster.備註 ?? "",
    });
  }, [selectedMaster]);

  useEffect(() => {
    if (!selectedUserForVisibility) {
      setVisibilityTables([]);
      setVisibilityColumns({});
      setVisibilityOverviewKpis(null);
      setVisibilityError(null);
      setEditUserForm({ name: "", role: "", dept: "", scope: "", password: "" });
      setEditUserError(null);
      return;
    }
    setEditUserForm({
      name: selectedUserForVisibility.name ?? "",
      role: selectedUserForVisibility.role ?? "",
      dept: selectedUserForVisibility.dept ?? "",
      scope: selectedUserForVisibility.scope ?? "",
      password: "",
    });
    setEditUserError(null);
    fetch(`/api/user-visibility?email=${encodeURIComponent(selectedUserForVisibility.email)}`, { cache: "no-store" })
      .then(safeResJson)
      .then((res) => {
        const d = res as {
          ok?: boolean;
          visibility?: { tables?: string[]; columns?: Record<string, string[]>; overview_kpis?: string[] | null };
        };
        if (d.ok && d.visibility) {
          setVisibilityTables(d.visibility.tables ?? []);
          setVisibilityColumns(d.visibility.columns ?? {});
          setVisibilityOverviewKpis(
            d.visibility.overview_kpis === undefined ? null : d.visibility.overview_kpis
          );
        } else {
          setVisibilityTables([]);
          setVisibilityColumns({});
          setVisibilityOverviewKpis(null);
        }
      })
      .catch(() => {
        setVisibilityTables([]);
        setVisibilityColumns({});
        setVisibilityOverviewKpis(null);
      });
  }, [selectedUserForVisibility]);

  useEffect(() => {
    if (!selectedTask) return;
    setEditTaskForm({
      任務名稱: selectedTask.任務 ?? "",
      任務狀態: selectedTask.狀態 ?? "",
      任務負責人: selectedTask.任務負責人 ?? "",
      任務完成: Boolean(selectedTask.任務完成),
    });
  }, [selectedTask]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (selectedTask) {
        setSelectedTask(null);
        setSaveTaskError(null);
      } else if (selectedMaster) {
        setSelectedMaster(null);
        setIsEditingMaster(false);
        setSaveMasterError(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedMaster, selectedTask]);

  const refreshDashboardData = useCallback(
    async (
      targets: Array<"users" | "master" | "tasks" | "partners" | "myVisibility" | "visibilityRules" | "systemConfig" | "invoices" | "finance" | "payout"> = [
        "users", "master", "tasks", "partners", "myVisibility", "visibilityRules", "systemConfig", "invoices", "finance", "payout",
      ]
    ) => {
      const need = new Set(targets);
      const reqs = [
        need.has("users") ? fetch("/api/users", { cache: "no-store" }).then(safeResJson) : Promise.resolve(null),
        need.has("master") ? fetch("/api/master", { cache: "no-store" }).then(safeResJson) : Promise.resolve(null),
        need.has("tasks") ? fetch("/api/tasks", { cache: "no-store" }).then(safeResJson) : Promise.resolve(null),
        need.has("partners") ? fetch("/api/partners", { cache: "no-store" }).then(safeResJson) : Promise.resolve(null),
        need.has("myVisibility") ? fetch("/api/user-visibility/me", { cache: "no-store" }).then(safeResJson) : Promise.resolve(null),
        need.has("visibilityRules") ? fetch("/api/visibility-rules", { cache: "no-store" }).then(safeResJson) : Promise.resolve(null),
        need.has("systemConfig") ? fetch("/api/system-config", { cache: "no-store" }).then(safeResJson) : Promise.resolve(null),
        need.has("invoices") ? fetch("/api/invoices", { cache: "no-store" }).then(safeResJson) : Promise.resolve(null),
        need.has("finance") ? fetch("/api/finance", { cache: "no-store" }).then(safeResJson) : Promise.resolve(null),
        need.has("payout") ? fetch("/api/payout", { cache: "no-store" }).then(safeResJson) : Promise.resolve(null),
      ] as const;
      const [u, m, t, pt, vis, rulesRes, cfgRes, invRes, finRes, payoutRes] = await Promise.allSettled(reqs);
      if (u.status === "fulfilled" && u.value && (u.value as { ok?: boolean }).ok)
        setUsers(((u.value as { users?: User[] }).users) ?? []);
      if (m.status === "fulfilled" && m.value && (m.value as { ok?: boolean }).ok)
        setMasterList(((m.value as { list?: MasterRow[] }).list) ?? []);
      if (t.status === "fulfilled" && t.value && (t.value as { ok?: boolean }).ok)
        setTasks(((t.value as { tasks?: TaskRow[] }).tasks) ?? []);
      if (pt.status === "fulfilled" && pt.value && (pt.value as { ok?: boolean }).ok) {
        const ptVal = pt.value as { partners?: PartnerRow[]; partnersError?: string };
        setPartners(ptVal.partners ?? []);
        setPartnersLoadError(ptVal.partnersError ?? null);
      }
      if (vis.status === "fulfilled" && vis.value && (vis.value as { ok?: boolean }).ok) {
        const v = vis.value as { tables?: string[]; columns?: Record<string, string[]>; overview_kpis?: string[] | null };
        setMyVisibility({
          tables: v.tables ?? [],
          columns: v.columns ?? {},
          overview_kpis: v.overview_kpis !== undefined ? v.overview_kpis : null,
        });
      }
      if (rulesRes.status === "fulfilled" && rulesRes.value && (rulesRes.value as { ok?: boolean }).ok) {
        const r = rulesRes.value as { rules?: Record<string, string[]> };
        setVisibilityRules(r.rules ?? {});
      }
      if (cfgRes.status === "fulfilled" && cfgRes.value && (cfgRes.value as { ok?: boolean }).ok) {
        const c = (cfgRes.value as {
          config?: {
            master_payout_defaults: Record<string, string>;
            project_types: string[];
            role_visibility: Record<string, { sections: string[] }>;
            roles?: string[];
            payout_dedupe_rules?: PayoutDedupeRulesByMode;
            overview_kpi_by_role?: Record<string, string[]>;
          };
        }).config;
        if (c) setSystemConfig(c);
      }
      if (invRes.status === "fulfilled" && invRes.value && (invRes.value as { ok?: boolean }).ok)
        setInvoices(((invRes.value as { invoices?: InvoiceRow[] }).invoices) ?? []);
      if (finRes.status === "fulfilled" && finRes.value && (finRes.value as { ok?: boolean }).ok)
        setFinance(((finRes.value as { finance?: Record<string, string | undefined>[] }).finance) ?? []);
      if (payoutRes.status === "fulfilled" && payoutRes.value && (payoutRes.value as { ok?: boolean }).ok)
        setPayoutList(((payoutRes.value as { list?: PayoutRow[] }).list) ?? []);
    },
    []
  );

  useEffect(() => {
    fetch("/api/auth/session", { credentials: "include", cache: "no-store" })
      .then(safeResJson)
      .then(async (session) => {
        const sess = session as { ok?: boolean; user?: User };
        if (!sess.ok || !sess.user) {
          setError("請先登入");
          setLoading(false);
          return;
        }
        setMe(sess.user);
        setLoading(false);
        await refreshDashboardData();
      })
      .catch(() => {
        setError("無法驗證登入狀態，請重新登入");
        setLoading(false);
      });
  }, [refreshDashboardData]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#faf8f5] p-8">
        <p className="text-lg font-semibold text-stone-500">載入中...</p>
      </div>
    );
  }

  if (error && !me) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#faf8f5] p-8">
        <p className="text-lg font-semibold text-amber-800">{error}</p>
        <Link
          href="/"
          className="mt-4 inline-block rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-bold text-slate-900 transition hover:bg-amber-400"
        >
          前往登入
        </Link>
      </div>
    );
  }

  async function handleLogout() {
    await fetch("/api/auth/session", { method: "DELETE", credentials: "include" });
    window.location.href = "/";
  }

  return (
    <div className="min-h-screen bg-[#faf8f5] p-8">
      {/* Logo 獨立一欄，置頂 */}
      <div className="mb-6 flex min-h-[4rem] items-center border-b border-stone-200/90 pb-4">
        <Link href="/" className="block max-w-full">
          <Image
            src="/logo.png"
            alt="SDH 盛德好"
            width={1257}
            height={174}
            sizes="(max-width: 768px) 100vw, 520px"
            className="h-14 w-auto max-w-[min(100%,520px)] object-contain object-left sm:h-16 md:h-[4.5rem]"
          />
        </Link>
      </div>

      <header className="mb-10 flex items-center justify-between">
        <div>
          <Link href="/" className="text-sm font-medium text-stone-500 transition hover:text-amber-800">
            ← 首頁
          </Link>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl">
            {me?.name ?? "總覽"} Dashboard
          </h1>
          <p className="mt-1.5 text-sm font-medium text-stone-500">
            {me?.name}（{me?.role}）· 全公司使用者、專案、任務、合作夥伴
          </p>
          {me && visibleSections.includes("overview") && activeSection !== "overview" && (
            <button
              type="button"
              onClick={() => setActiveSection("overview")}
              className="mt-2 text-left text-sm font-semibold text-amber-800 transition hover:text-amber-700 hover:underline"
            >
              前往總覽
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="rounded-xl border border-stone-300 bg-stone-50 px-4 py-2.5 text-sm font-semibold text-stone-600 transition hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800"
        >
          登出
        </button>
      </header>

      {/* 資料分頁：左側直向導覽 + 右側區塊內容（管理者多「可見性與權限」） */}
      {me && tabSections.length > 0 && (
        <div className="flex w-full flex-col gap-4 md:flex-row md:items-start md:gap-8">
          <aside className="w-full shrink-0 rounded-2xl border border-stone-200/90 bg-white/90 p-3 shadow-lg ring-1 ring-amber-100/60 md:sticky md:top-6 md:w-56 md:self-start">
            <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-stone-500">資料區塊</p>
            <nav className="flex max-h-[min(40vh,22rem)] flex-col gap-1 overflow-y-auto pr-0.5 md:max-h-[calc(100vh-10rem)]" aria-label="Dashboard 分頁">
              {tabSections.map((sec) => (
                <button
                  key={sec}
                  type="button"
                  draggable
                  onDragStart={() => setDraggingTab(sec)}
                  onDragEnd={() => setDraggingTab(null)}
                  onDragOver={(e) => {
                    if (!draggingTab || draggingTab === sec) return;
                    e.preventDefault();
                    setTabOrder((prev) => {
                      const current = prev && prev.length ? prev : tabSections;
                      const fromIndex = current.indexOf(draggingTab);
                      const toIndex = current.indexOf(sec);
                      if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return current;
                      const next = [...current];
                      next.splice(fromIndex, 1);
                      next.splice(toIndex, 0, draggingTab);
                      return next;
                    });
                  }}
                  onClick={() => setActiveSection(sec)}
                  className={`w-full rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition ${
                    activeSection === sec
                      ? "border border-amber-400/70 bg-amber-50 text-amber-700 shadow-sm shadow-amber-100/30"
                      : "border border-transparent text-stone-600 hover:bg-amber-50/80 hover:text-stone-900"
                  }`}
                >
                  {TABLE_LABELS[sec] ?? sec}
                </button>
              ))}
            </nav>
            <p className="mt-3 border-t border-stone-200/90 pt-3 text-[10px] leading-relaxed text-stone-500">
              拖曳項目可調整順序。目前：<span className="font-semibold text-amber-800">{TABLE_LABELS[activeSection ?? ""] ?? activeSection ?? "—"}</span>
            </p>
          </aside>

          <div className="min-w-0 flex-1 space-y-10">
            {/* 管理者專用：可見性與權限管理分頁內容 */}
            {canEditVisibility && activeSection === "visibility" && (
              <section className="rounded-2xl border-2 border-amber-200 bg-white/90 p-6 shadow-xl ring-1 ring-amber-500/20">
                <h2 className="mb-2 text-xl font-bold tracking-tight text-amber-800">可見性與權限管理</h2>
                <p className="mb-4 text-sm text-stone-500">依序設定：角色管理 → ① 角色可見區塊 → ④ 總覽指標 → ② 資料可見規則 → ③ 使用者可見範圍</p>

                {/* 如何連結：可收合說明 */}
                <div className="mb-6 rounded-xl border border-stone-200/90 bg-white/90 p-4">
                  <button type="button" onClick={() => setShowHowItWorks((v) => !v)} className="flex w-full items-center justify-between text-left text-sm font-medium text-stone-600 hover:text-amber-800">
                    <span>📋 資料如何連結、存在哪裡（點擊展開）</span>
                    <span className="text-stone-500">{showHowItWorks ? "▼" : "▶"}</span>
                  </button>
                  {showHowItWorks && (
                    <div className="mt-4 space-y-3 border-t border-stone-200/90 pt-4 text-xs text-stone-500">
                      <p><strong className="text-stone-600">角色列表</strong> → 存於 <code className="rounded bg-stone-100 px-1">system_config</code> 的 <code className="rounded bg-stone-100 px-1">roles</code>（陣列）。新增使用者時的角色下拉與這裡一致。</p>
                      <p><strong className="text-stone-600">① 角色可見區塊</strong> → 存於 <code className="rounded bg-stone-100 px-1">system_config</code> 的 <code className="rounded bg-stone-100 px-1">role_visibility</code>。每個角色可勾選能進入的區塊（overview、master、partners、tasks、payout、finance、invoices）。</p>
                      <p><strong className="text-stone-600">④ 總覽指標</strong> → 存於 <code className="rounded bg-stone-100 px-1">system_config</code> 的 <code className="rounded bg-stone-100 px-1">overview_kpi_by_role</code>，決定總覽頁頂部數字卡；③ 可為單一帳號覆寫（<code className="rounded bg-stone-100 px-1">user_visibility.overview_kpis</code>）。</p>
                      <p><strong className="text-stone-600">② 資料可見規則</strong> → 存於 <code className="rounded bg-stone-100 px-1">visibility_rules</code> 表。勾選的欄位若符合登入者姓名/Email，該列才會顯示（列級過濾）。</p>
                      <p><strong className="text-stone-600">③ 使用者可見範圍</strong> → 存於 <code className="rounded bg-stone-100 px-1">user_visibility</code> 表（依 user_email）。若某使用者有設定，會覆蓋 ①，且可細到「每個 Table 顯示哪些欄位」。</p>
                      <p className="text-amber-800">顯示優先順序：③ 有設定 → 用 ③；否則 ① 有該角色設定 → 用 ①；否則用程式預設。</p>
                    </div>
                  )}
                </div>

                <div className="space-y-6">
                  {/* 角色管理：新增/刪除角色，同步到 ① 與新增使用者下拉 */}
                  <div className="rounded-xl border border-stone-200/90 bg-stone-50/90 p-4">
                    <h3 className="mb-3 font-semibold text-amber-800">角色管理</h3>
                    <p className="mb-3 text-xs text-stone-500">此處角色會同步到「① 角色可見區塊」與「新增使用者」的角色下拉。刪除角色前請確認無使用者使用該角色。</p>
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      {displayRoles.map((role) => (
                        <span key={role} className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white/90 px-3 py-1.5 text-sm text-stone-600">
                          {role}
                          <button
                            type="button"
                            onClick={() => {
                              const next = displayRoles.filter((r) => r !== role);
                              if (next.length === 0) return;
                              setSystemConfig((c) => (c ? { ...c, roles: next } : null));
                            }}
                            className="text-stone-500 hover:text-red-400"
                            title="刪除此角色"
                          >×</button>
                        </span>
                      ))}
                      <input
                        type="text"
                        value={newRoleName}
                        onChange={(e) => setNewRoleName(e.target.value.trim())}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            const v = newRoleName.trim();
                            if (v && !displayRoles.includes(v)) {
                              setSystemConfig((c) => (c ? { ...c, roles: [...(c.roles ?? displayRoles), v] } : null));
                              setNewRoleName("");
                            }
                          }
                        }}
                        placeholder="輸入新角色名稱"
                        className="w-40 rounded-lg border border-stone-300 bg-white/90 px-3 py-1.5 text-sm text-stone-900 placeholder:text-stone-500"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const v = newRoleName.trim();
                          if (!v || displayRoles.includes(v)) return;
                          setSystemConfig((c) => (c ? { ...c, roles: [...(c.roles ?? displayRoles), v] } : null));
                          setNewRoleName("");
                        }}
                        className="rounded-lg bg-amber-100/90 px-3 py-1.5 text-xs font-bold text-amber-800 transition hover:bg-amber-200/60"
                      >
                        新增角色
                      </button>
                    </div>
                    <button
                      type="button"
                      disabled={savingRoles}
                      onClick={async () => {
                        setSavingRoles(true);
                        try {
                          const rolesToSave = systemConfig?.roles ?? displayRoles;
                          const res = await fetch("/api/system-config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "roles", value: rolesToSave }) });
                          const data = (await safeResJson(res)) as { ok?: boolean; config?: { roles?: string[]; role_visibility?: Record<string, { sections: string[] }> } };
                          if (res.ok && data.ok && data.config) {
                            setSystemConfig((c) => c ? { ...c, roles: data.config!.roles ?? c.roles } : null);
                            const rv = systemConfig?.role_visibility ?? {};
                            const nextRv: Record<string, { sections: string[] }> = {};
                            for (const role of rolesToSave) {
                              nextRv[role] = rv[role] ?? ROLE_VISIBILITY[role] ?? { sections: ["overview", "tasks"] };
                            }
                            await fetch("/api/system-config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "role_visibility", value: nextRv }) });
                            await refreshDashboardData(["systemConfig"]);
                          }
                        } finally {
                          setSavingRoles(false);
                        }
                      }}
                      className="rounded-lg bg-amber-100/90 px-3 py-1.5 text-xs font-bold text-amber-800 transition hover:bg-amber-200/60 disabled:opacity-60"
                    >
                      {savingRoles ? "儲存中" : "儲存角色"}
                    </button>
                  </div>

                  {/* 第1層：角色可見區塊 */}
                  <div className="rounded-xl border border-stone-200/90 bg-stone-50/90 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="font-semibold text-amber-800">① 角色可見區塊</h3>
                      <button
                        type="button"
                        disabled={savingConfig === "role_visibility"}
                        onClick={async () => {
                          setSavingConfig("role_visibility");
                          try {
                            // 儲存時必須帶上「全部角色」並與預設合併，否則只會寫回畫面上有的角色、其他角色會被 DB 覆蓋掉
                            const current = systemConfig?.role_visibility ?? {};
                            const rv: Record<string, { sections: string[] }> = {};
                            for (const role of displayRoles) {
                              rv[role] = current[role] ?? ROLE_VISIBILITY[role] ?? { sections: ["overview", "tasks"] };
                            }
                            const res = await fetch("/api/system-config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "role_visibility", value: rv }) });
                            const data = (await safeResJson(res)) as { ok?: boolean; config?: { role_visibility: Record<string, { sections: string[] }> } };
                            if (res.ok && data.ok && data.config) {
                              setSystemConfig((c) => c ? { ...c, role_visibility: data.config!.role_visibility } : null);
                              await refreshDashboardData(["systemConfig"]);
                            }
                          } catch {}
                          setSavingConfig(null);
                        }}
                        className="rounded-lg bg-amber-100/90 px-3 py-1.5 text-xs font-bold text-amber-800 transition hover:bg-amber-200/60 disabled:opacity-60"
                      >
                        {savingConfig === "role_visibility" ? "儲存中" : "儲存"}
                      </button>
                    </div>
                    <p className="mb-3 text-xs text-stone-500">各角色可進入的區塊（overview、master、partners、tasks、payout、finance、invoices 等）</p>
                    <div className="space-y-2">
                      {displayRoles.map((role) => {
                        const cfg = systemConfig?.role_visibility?.[role] ?? ROLE_VISIBILITY[role] ?? { sections: ["overview", "tasks"] };
                        return [role, cfg] as const;
                      }).map(([role, cfg]) => (
                        <div key={role} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                          <span className="w-16 text-xs font-medium text-stone-900">{role}</span>
                          <div className="flex flex-wrap gap-x-2 gap-y-1">
                            {TABLE_KEYS.map((s) => {
                              const sections = cfg?.sections ?? [];
                              const checked = sections.includes(s);
                              return (
                                <label key={s} className="flex cursor-pointer items-center gap-1">
                                  <input type="checkbox" checked={checked} onChange={() => {
                                    const next = checked ? sections.filter((x) => x !== s) : [...sections, s];
                                    setSystemConfig((c) => {
                                      const base = c ?? { master_payout_defaults: { ...MASTER_PAYOUT_DEFAULTS }, project_types: [...PROJECT_TYPES], role_visibility: {} };
                                      const rv = { ...base.role_visibility, [role]: { ...(typeof cfg === "object" ? cfg : {}), sections: next } };
                                      return { ...base, role_visibility: rv };
                                    });
                                  }} className="h-3 w-3 rounded border-stone-300 bg-stone-50 text-amber-500" />
                                  <span className="text-xs text-stone-600">{TABLE_LABELS[s] ?? s}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* ④ 總覽指標可見（依角色）；③ 使用者可覆寫 */}
                  <div className="rounded-xl border border-stone-200/90 bg-stone-50/90 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="font-semibold text-amber-800">④ 總覽指標（依角色）</h3>
                      <button
                        type="button"
                        disabled={savingConfig === "overview_kpi_by_role"}
                        onClick={async () => {
                          setSavingConfig("overview_kpi_by_role");
                          try {
                            const current = systemConfig?.overview_kpi_by_role ?? {};
                            const rv: Record<string, string[]> = {};
                            for (const role of displayRoles) {
                              rv[role] = current[role]?.length
                                ? [...current[role]]
                                : getDefaultOverviewKpisForRole(role);
                            }
                            const res = await fetch("/api/system-config", {
                              method: "PUT",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ key: "overview_kpi_by_role", value: rv }),
                            });
                            const data = (await safeResJson(res)) as { ok?: boolean; config?: { overview_kpi_by_role?: Record<string, string[]> } };
                            if (res.ok && data.ok && data.config?.overview_kpi_by_role) {
                              setSystemConfig((c) =>
                                c ? { ...c, overview_kpi_by_role: data.config!.overview_kpi_by_role } : null
                              );
                              await refreshDashboardData(["systemConfig"]);
                            }
                          } catch {
                            /* ignore */
                          }
                          setSavingConfig(null);
                        }}
                        className="rounded-lg bg-amber-100/90 px-3 py-1.5 text-xs font-bold text-amber-800 transition hover:bg-amber-200/60 disabled:opacity-60"
                      >
                        {savingConfig === "overview_kpi_by_role" ? "儲存中" : "儲存"}
                      </button>
                    </div>
                    <p className="mb-3 text-xs text-stone-500">
                      各角色在總覽頁頂部可看到的匯總（與資料區塊分開設定）。③ 可為單一帳號覆寫。
                    </p>
                    <div className="space-y-2">
                      {displayRoles.map((role) => {
                        const keys =
                          systemConfig?.overview_kpi_by_role?.[role] ?? getDefaultOverviewKpisForRole(role);
                        return (
                          <div key={role} className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
                            <span className="w-16 shrink-0 text-xs font-medium text-stone-900">{role}</span>
                            <div className="flex flex-wrap gap-x-2 gap-y-1">
                              {OVERVIEW_KPI_KEYS.map((k) => {
                                const checked = keys.includes(k);
                                return (
                                  <label key={k} className="flex cursor-pointer items-center gap-1">
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => {
                                        const cur =
                                          systemConfig?.overview_kpi_by_role?.[role] ??
                                          getDefaultOverviewKpisForRole(role);
                                        const next = checked ? cur.filter((x) => x !== k) : [...cur, k];
                                        setSystemConfig((c) => ({
                                          ...(c ?? {
                                            master_payout_defaults: { ...MASTER_PAYOUT_DEFAULTS },
                                            project_types: [...PROJECT_TYPES],
                                            role_visibility: {},
                                          }),
                                          overview_kpi_by_role: {
                                            ...((c ?? systemConfig)?.overview_kpi_by_role ?? {}),
                                            [role]: next,
                                          },
                                        }));
                                      }}
                                      className="h-3 w-3 rounded border-stone-300 bg-stone-50 text-amber-500"
                                    />
                                    <span className="text-xs text-stone-600">{OVERVIEW_KPI_LABELS[k]}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* 第2層：資料可見規則 */}
                  <div className="rounded-xl border border-stone-200/90 bg-stone-50/90 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="font-semibold text-amber-800">② 資料可見規則</h3>
                      <button
                        type="button"
                        disabled={savingVisibilityRules}
                        onClick={async () => {
                          setVisibilityRulesError(null);
                          setSavingVisibilityRules(true);
                          try {
                            /** 每個 table_key 都寫入 DB；缺 key 時以前端畫面為準視為 []，避免只送部分 rules 導致 partners 等未更新仍用舊 match_fields */
                            const fullRules: Record<string, string[]> = {};
                            for (const tk of TABLE_KEYS) {
                              const v = visibilityRules[tk];
                              const arr = Array.isArray(v) ? v : [];
                              fullRules[tk] = arr.map((f) => String(f).trim()).filter(Boolean);
                            }
                            const res = await fetch("/api/visibility-rules", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rules: fullRules }) });
                            const data = (await safeResJson(res)) as { ok?: boolean; error?: string; rules?: Record<string, string[]> };
                            if (!res.ok || !data.ok) { setVisibilityRulesError(data.error ?? "儲存失敗"); setSavingVisibilityRules(false); return; }
                            setVisibilityRules(data.rules ?? fullRules);
                          } catch (err) { setVisibilityRulesError(err instanceof Error ? err.message : "儲存失敗"); }
                          setSavingVisibilityRules(false);
                        }}
                        className="rounded-lg bg-amber-100/90 px-3 py-1.5 text-xs font-bold text-amber-800 transition hover:bg-amber-200/60 disabled:opacity-60"
                      >
                        {savingVisibilityRules ? "儲存中" : "儲存"}
                      </button>
                    </div>
                    <p className="mb-4 text-xs text-stone-500">勾選的欄位若符合登入者姓名/Email，該列會顯示（OR 邏輯）</p>
                    {visibilityRulesError && <p className="mb-3 text-xs text-amber-800">{visibilityRulesError}</p>}
                    <div className="space-y-5">
                      {TABLE_KEYS.map((tableKey) => {
                        const cols = TABLE_COLUMNS[tableKey] ?? [];
                        const selected = visibilityRules[tableKey] ?? [];
                        return (
                          <div key={tableKey} className="rounded-lg border border-stone-200/70 bg-stone-50/95 p-3">
                            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                              <p className="text-xs font-semibold uppercase tracking-wider text-amber-800">{TABLE_LABELS[tableKey] ?? tableKey}</p>
                              {tableKey === "partners" && (
                                <button
                                  type="button"
                                  disabled={savingVisibilityRules}
                                  className="rounded border border-stone-200 bg-stone-50 px-2 py-1 text-[10px] font-semibold text-stone-500 transition hover:bg-stone-100 hover:text-amber-800 disabled:opacity-50"
                                  onClick={async () => {
                                    setVisibilityRulesError(null);
                                    setSavingVisibilityRules(true);
                                    try {
                                      const fullRules: Record<string, string[]> = {};
                                      for (const tk of TABLE_KEYS) {
                                        if (tk === "partners") {
                                          fullRules[tk] = [];
                                          continue;
                                        }
                                        const v = visibilityRules[tk];
                                        const arr = Array.isArray(v) ? v : [];
                                        fullRules[tk] = arr.map((f) => String(f).trim()).filter(Boolean);
                                      }
                                      const res = await fetch("/api/visibility-rules", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rules: fullRules }) });
                                      const data = (await safeResJson(res)) as { ok?: boolean; error?: string; rules?: Record<string, string[]> };
                                      if (!res.ok || !data.ok) {
                                        setVisibilityRulesError(data.error ?? "儲存失敗");
                                        setSavingVisibilityRules(false);
                                        return;
                                      }
                                      setVisibilityRules(data.rules ?? fullRules);
                                    } catch (err) {
                                      setVisibilityRulesError(err instanceof Error ? err.message : "儲存失敗");
                                    }
                                    setSavingVisibilityRules(false);
                                  }}
                                >
                                  合作夥伴改為全部顯示（不篩選）
                                </button>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-2">
                              {cols.map(({ key, label }) => (
                                <label key={key} className="flex cursor-pointer items-center gap-1.5">
                                  <input type="checkbox" checked={selected.includes(key)} onChange={(e) => setVisibilityRules((p) => ({ ...p, [tableKey]: e.target.checked ? [...(p[tableKey] ?? []), key] : (p[tableKey] ?? []).filter((f) => f !== key) }))} className="h-3.5 w-3.5 rounded border-stone-300 bg-stone-50 text-amber-500" />
                                  <span className="text-xs text-stone-600">{label}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* 第3層：使用者可見範圍 */}
                  <div className="rounded-xl border border-stone-200/90 bg-stone-50/90 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="font-semibold text-amber-800">③ 使用者可見範圍</h3>
                      <button
                        type="button"
                        onClick={() => { setCreateUserForm({ email: "", name: "", password: "", role: displayRoles.includes("經紀人") ? "經紀人" : (displayRoles[0] ?? "經紀人"), dept: "", scope: "" }); setCreateUserError(null); setShowCreateUser(true); }}
                        className="rounded-lg bg-amber-100/90 px-3 py-1.5 text-xs font-bold text-amber-800 transition hover:bg-amber-200/60"
                      >
                        新增使用者
                      </button>
                    </div>
                    <p className="mb-4 text-xs text-stone-500">
                      點選使用者可設定 Table／欄位與總覽指標（例：不勾選專案成本、總覽隱藏毛利率）。
                    </p>
                    <div className="overflow-hidden rounded-lg border border-stone-200/90">
                      <table className="min-w-full divide-y divide-stone-200">
                        <thead className="bg-stone-100">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-amber-800">Email</th>
                            <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-stone-600">姓名</th>
                            <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-stone-600">角色</th>
                            <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-stone-600">部門</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-stone-200 bg-amber-50/40">
                          {users.map((user) => (
                            <tr key={user.email} className="cursor-pointer transition hover:bg-amber-50/80" onClick={() => setSelectedUserForVisibility(user)}>
                              <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-stone-900">{user.email}</td>
                              <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-stone-900">{user.name}</td>
                              <td className="whitespace-nowrap px-4 py-3 text-sm text-stone-600">{user.role}</td>
                              <td className="whitespace-nowrap px-4 py-3 text-sm text-stone-600">{user.dept}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </section>
            )}

        {/* 總覽：與我有關的進行中專案 + 指派給我的任務；董事長可切全公司 */}
        {activeSection === "overview" && (
          <section className="rounded-2xl border border-stone-200/90 bg-white/90 p-4 shadow-xl ring-1 ring-amber-100/60 sm:p-6">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-stone-900">總覽</h2>
                <p className="mt-1 text-sm text-stone-500">
                  {overviewDirectorCompanyView
                    ? "顯示可見範圍內的進行中專案與未完成任務（全公司視角，仍遵守②列級規則）。"
                    : "進行中且與您相關的專案，以及負責人為您的未完成任務。"}
                </p>
              </div>
              {me?.role === "董事長" && (
                <div className="flex shrink-0 rounded-xl border border-stone-200 bg-amber-50/90 p-1">
                  <button
                    type="button"
                    onClick={() => setOverviewScope("mine")}
                    className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
                      overviewScope === "mine" ? "bg-amber-500 text-slate-900 shadow shadow-amber-200/40" : "text-stone-500 hover:text-stone-900"
                    }`}
                  >
                    與我有關
                  </button>
                  <button
                    type="button"
                    onClick={() => setOverviewScope("company")}
                    className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
                      overviewScope === "company" ? "bg-amber-500 text-slate-900 shadow shadow-amber-200/40" : "text-stone-500 hover:text-stone-900"
                    }`}
                  >
                    全公司
                  </button>
                </div>
              )}
            </div>

            {visibleOverviewKpiKeys.length > 0 && overviewKpiMetrics && (
              <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {visibleOverviewKpiKeys.map((k) => (
                  <div
                    key={k}
                    className="rounded-xl border border-stone-200/90 bg-white/90 px-3 py-3 shadow-inner ring-1 ring-amber-100/60 sm:px-4"
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">
                      {OVERVIEW_KPI_LABELS[k]}
                    </p>
                    <p className="mt-1.5 text-lg font-bold tabular-nums text-stone-900 sm:text-xl">
                      {k === "projectCount" && overviewKpiMetrics.projectCount}
                      {k === "pendingTasks" && overviewKpiMetrics.pendingTasks}
                      {k === "totalRevenue" && formatAmount(String(Math.round(overviewKpiMetrics.totalRevenue)))}
                      {k === "totalCost" && formatAmount(String(Math.round(overviewKpiMetrics.totalCost)))}
                      {k === "grossMargin" &&
                        (overviewKpiMetrics.grossMarginPct != null
                          ? `${overviewKpiMetrics.grossMarginPct.toFixed(1)}%`
                          : "—")}
                    </p>
                  </div>
                ))}
              </div>
            )}

            <div className="grid gap-6 lg:grid-cols-2">
              <div className="min-w-0 rounded-xl border border-stone-200/90 bg-white/95 p-4">
                <h3 className="mb-1 text-sm font-bold text-amber-800">
                  {overviewDirectorCompanyView ? "進行中專案" : "與我相關的進行中專案"}
                </h3>
                {!overviewDirectorCompanyView && (
                  <p className="mb-3 text-[11px] leading-relaxed text-stone-500">
                    專案需為進行中，且您在 BDPM／引薦人／管理員／執行管理員／KOL 名稱欄位之一與登入姓名或 Email 相符，或您有被指派的任務隸屬該專案。
                  </p>
                )}
                {overviewProjectRows.length === 0 ? (
                  <p className="py-6 text-center text-sm text-stone-500">目前沒有符合條件的專案</p>
                ) : (
                  <div className="max-h-[min(24rem,50vh)] overflow-auto rounded-lg border border-stone-200/90">
                    <table className="min-w-full divide-y divide-stone-200 text-left text-sm">
                      <thead className="sticky top-0 z-10 bg-[#fffefb]/95">
                        <tr>
                          <th className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-amber-800">專案名稱</th>
                          <th className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-stone-600">狀態</th>
                          <th className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-stone-600">專案ID</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-200">
                        {overviewProjectRows.map((row) => (
                          <tr key={row.id || row.專案ID} className="bg-amber-50/40 hover:bg-amber-50/80">
                            <td className="max-w-[10rem] truncate px-3 py-2 font-medium text-stone-900" title={row.專案名稱 ?? ""}>
                              {row.專案名稱 ?? "—"}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-stone-600">{row.專案狀態 ?? "—"}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-stone-500">{row.專案ID}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="min-w-0 rounded-xl border border-stone-200/90 bg-white/95 p-4">
                <h3 className="mb-1 text-sm font-bold text-amber-800">
                  {overviewDirectorCompanyView ? "未完成任務" : "指派給我的任務"}
                </h3>
                <p className="mb-3 text-[11px] text-stone-500">以「任務負責人」等於您的姓名或 Email 為準。</p>
                {overviewTaskRows.length === 0 ? (
                  <p className="py-6 text-center text-sm text-stone-500">目前沒有符合條件的任務</p>
                ) : (
                  <div className="max-h-[min(24rem,50vh)] overflow-auto rounded-lg border border-stone-200/90">
                    <table className="min-w-full divide-y divide-stone-200 text-left text-sm">
                      <thead className="sticky top-0 z-10 bg-[#fffefb]/95">
                        <tr>
                          <th className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-amber-800">任務</th>
                          <th className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-stone-600">專案</th>
                          <th className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-stone-600">狀態</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-200">
                        {overviewTaskRows.map((t, i) => (
                          <tr key={t.任務ID ?? `${t.專案ID}-${i}`} className="bg-amber-50/40 hover:bg-amber-50/80">
                            <td className="max-w-[9rem] truncate px-3 py-2 font-medium text-stone-900" title={t.任務 ?? ""}>
                              {t.任務 ?? "—"}
                            </td>
                            <td className="max-w-[7rem] truncate px-3 py-2 text-stone-500" title={t.專案名稱 ?? t.專案ID ?? ""}>
                              {t.專案名稱 ?? t.專案ID ?? "—"}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-stone-600">{t.狀態 ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* 大總表 */}
        {activeSection === "master" && (
          <section className="rounded-2xl border border-stone-200/90 bg-white/90 p-4 shadow-xl ring-1 ring-amber-100/60 sm:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-bold tracking-tight text-stone-900">大總表</h2>
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative">
                  <input
                    type="text"
                    value={masterSearch}
                    onChange={(e) => setMasterSearch(e.target.value)}
                    placeholder="搜尋專案ID、名稱、KOL、廠商…"
                    className="w-60 rounded-full border border-stone-200 bg-stone-50 px-3.5 py-1.5 text-xs text-stone-800 placeholder:text-stone-500 focus:border-amber-500/60 focus:outline-none"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-stone-500">
                    搜尋
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const today = new Date().toISOString().slice(0, 10);
                    setCreateForm({
                      專案ID: generateProjectId(),
                      專案名稱: "",
                      專案類型: "",
                      專案狀態: "",
                      狀態確認日期: "",
                      開案日期: today,
                      專案總金額未稅: "",
                      專案營收: "",
                      專案成本: "",
                      KOL費用未稅: "",
                      KOL名稱: "",
                      專案費用類型: "",
                      廠商名稱: "",
                      專案資料夾: "",
                      專案BDPM: "",
                      專案BDPM分潤成數: payoutDefaults.專案BDPM分潤成數,
                      專案引薦人: "",
                      專案引薦人分潤成數: payoutDefaults.專案引薦人分潤成數,
                      專案管理員: "",
                      專案管理員分潤成數: payoutDefaults.專案管理員分潤成數,
                      執行管理員: "",
                      執行管理員分潤成數: payoutDefaults.執行管理員分潤成數,
                      專案內容: "",
                      備註: "",
                    });
                    setCreateError(null);
                    setShowCreateMaster(true);
                  }}
                  className="rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-bold text-slate-900 shadow-lg shadow-amber-200/30 transition hover:bg-amber-400"
                >
                  新增專案
                </button>
              </div>
            </div>
            <div className="overflow-x-auto rounded-xl border border-stone-200/90 ring-1 ring-amber-100/60">
              <table className="min-w-full table-fixed divide-y divide-stone-200">
                <colgroup>
                  {masterVisibleCols.map((k) => (
                    <col key={k} className={k === "專案ID" ? "w-[5rem] min-w-[5rem]" : k === "專案名稱" ? "min-w-[12rem]" : "min-w-[5rem]"} />
                  ))}
                </colgroup>
                <thead className="sticky top-0 z-20 bg-stone-100">
                  <tr>
                    {masterVisibleCols.map((k) => (
                      <th
                        key={k}
                        className={
                          k === "專案ID"
                            ? "sticky left-0 z-30 w-[5rem] min-w-[5rem] max-w-[5rem] bg-stone-100 px-2 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-amber-800 whitespace-nowrap"
                            : k === "專案名稱"
                              ? "sticky left-[5rem] z-30 w-48 min-w-[12rem] max-w-[12rem] bg-stone-100 px-4 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-amber-800 whitespace-nowrap"
                              : "min-w-[5rem] px-4 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-stone-600 whitespace-nowrap"
                        }
                      >
                        {tableColumnLabels.master?.[k] ?? k}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200 bg-amber-50/40">
                  {filteredMasterList.length === 0 ? (
                    <tr>
                      <td colSpan={masterVisibleCols.length || 15} className="px-4 py-8 text-center text-base font-medium text-stone-500">
                        尚無大總表資料，請點「新增專案」建立第一筆
                      </td>
                    </tr>
                  ) : searchedMasterList.length === 0 ? (
                    <tr>
                      <td colSpan={masterVisibleCols.length || 15} className="px-4 py-8 text-center text-base font-medium text-stone-500">
                        沒有符合搜尋結果
                      </td>
                    </tr>
                  ) : (
                    visibleMasterRows.map((row) => {
                      const pid = row.專案ID ?? "";
                      const isExpanded = expandedProjectId === pid;
                      const projectTasks = filteredTasks.filter((t) => (t.專案ID ?? "").trim().toLowerCase() === pid.trim().toLowerCase());
                      return (
                        <Fragment key={row.id ?? pid}>
                          <tr
                            key={row.id ?? pid}
                            className="cursor-pointer transition hover:bg-amber-50/80"
                            onClick={() => {
                              setSelectedMaster(row);
                              setIsEditingMaster(false);
                              setSaveMasterError(null);
                            }}
                          >
                            {masterVisibleCols.map((k) => {
                              const amountKeys = ["專案總金額未稅", "專案營收", "專案成本", "KOL費用未稅"];
                              const isAmount = amountKeys.includes(k);
                              const val = (row as unknown as Record<string, unknown>)[k];
                              if (k === "專案ID") {
                                return (
                                  <td key={k} className="sticky left-0 z-20 w-[5rem] min-w-[5rem] max-w-[5rem] bg-white/90 px-2 py-3.5" title={pid}>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setExpandedProjectId((prev) => (prev === pid ? null : pid));
                                        setAddingTaskFor(null);
                                        setAddTaskError(null);
                                        setNewTaskForm({ 任務名稱: "", 任務狀態: "", 任務負責人: "" });
                                      }}
                                      className="mr-2 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-stone-300 bg-stone-50 text-stone-500 transition hover:bg-amber-100/90 hover:border-amber-300 hover:text-amber-800"
                                      title={isExpanded ? "收合任務" : "展開任務"}
                                    >
                                      <svg className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                      </svg>
                                    </button>
                                    <span className="truncate text-xs font-normal text-stone-500" title={pid || undefined}>{pid ? "SDH-…" : "—"}</span>
                                  </td>
                                );
                              }
                              if (k === "專案名稱") {
                                return (
                                  <td key={k} className="sticky left-[5rem] z-20 w-48 min-w-[12rem] max-w-[12rem] truncate bg-white/90 px-4 py-3.5 text-sm font-medium text-stone-900" title={String(val ?? "")}>
                                    {String(val ?? "—")}
                                  </td>
                                );
                              }
                              return (
                                <td key={k} className={`whitespace-nowrap px-4 py-3.5 text-sm font-medium text-stone-600 ${isAmount ? "tabular-nums" : ""}`}>
                                  {isAmount ? formatAmount(String(val ?? "")) : (String(val ?? "—"))}
                                </td>
                              );
                            })}
                          </tr>
                          {isExpanded && (
                            <tr key={`${pid}-tasks`}>
                              <td colSpan={masterVisibleCols.length || 15} className="border-t-0 bg-stone-50 px-4 py-4">
                                <div className="rounded-xl border border-stone-200/90 bg-stone-50/90 p-4">
                                  <h3 className="mb-3 text-sm font-bold uppercase tracking-wider text-amber-800">此專案任務</h3>
                                  <div className="mb-4 overflow-hidden rounded-lg border border-stone-200/90">
                                    <table className="min-w-full divide-y divide-stone-200">
                                      <thead className="bg-amber-100/80">
                                        <tr>
                                          <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-stone-500">任務</th>
                                          <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-stone-500">狀態</th>
                                          <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-stone-500">任務負責人</th>
                                          <th className="px-3 py-2 text-center text-xs font-semibold uppercase text-stone-500">完成</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-stone-200 bg-white/90">
                                        {projectTasks.length === 0 ? (
                                          <tr>
                                            <td colSpan={4} className="px-3 py-4 text-center text-sm text-stone-500">
                                              尚無任務，請點「新增任務」新增
                                            </td>
                                          </tr>
                                        ) : (
                                          projectTasks.map((t, i) => (
                                            <tr
                                              key={t.任務ID ?? i}
                                              className="cursor-pointer hover:bg-amber-50/80"
                                              onClick={() => setSelectedTask(t)}
                                            >
                                              <td className="px-3 py-2.5 text-sm text-stone-900">{t.任務 ?? "—"}</td>
                                              <td className="whitespace-nowrap px-3 py-2.5 text-sm text-stone-600">{t.狀態 ?? "—"}</td>
                                              <td className="whitespace-nowrap px-3 py-2.5 text-sm text-stone-600">
                                                <span className="inline-flex items-center gap-1">
                                                  {t.任務負責人 ?? "—"}
                                                  {t.任務負責人 && t.任務ID && (
                                                    <button
                                                      type="button"
                                                      onClick={async (ev) => {
                                                        ev.stopPropagation();
                                                        if (!t.任務ID) return;
                                                        setRemindingTaskId(t.任務ID);
                                                        try {
                                                          await fetch("/api/tasks/remind", {
                                                            method: "POST",
                                                            headers: { "Content-Type": "application/json" },
                                                            body: JSON.stringify({ 任務ID: t.任務ID }),
                                                          });
                                                        } finally {
                                                          setRemindingTaskId(null);
                                                        }
                                                      }}
                                                      disabled={remindingTaskId === t.任務ID}
                                                      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-stone-300 bg-stone-50 text-stone-500 transition hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800 disabled:opacity-50"
                                                      title="發信提醒"
                                                    >
                                                      {remindingTaskId === t.任務ID ? (
                                                        <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
                                                      ) : (
                                                        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                                        </svg>
                                                      )}
                                                    </button>
                                                  )}
                                                </span>
                                              </td>
                                              <td className="px-3 py-2.5 text-center">
                                                <button
                                                  type="button"
                                                  onClick={async (ev) => {
                                                    ev.stopPropagation();
                                                    if (!t.任務ID) return;
                                                    const next = !t.任務完成;
                                                    try {
                                                      const res = await fetch("/api/tasks", {
                                                        method: "PATCH",
                                                        headers: { "Content-Type": "application/json" },
                                                        body: JSON.stringify({ 任務ID: t.任務ID, 任務完成: next }),
                                                      });
                                                      const data = (await safeResJson(res)) as { ok?: boolean; task?: TaskRow };
                                                      if (res.ok && data.ok) {
                                                        setTasks((prev) => prev.map((x) => (x.任務ID === t.任務ID ? data.task! : x)));
                                                      }
                                                    } catch {
                                                      /* 忽略 */
                                                    }
                                                  }}
                                                  className="inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded border-2 transition hover:border-amber-400/70 hover:bg-amber-50"
                                                  style={{
                                                    backgroundColor: t.任務完成 ? "rgba(245,158,11,0.2)" : "transparent",
                                                    borderColor: t.任務完成 ? "rgba(245,158,11,0.5)" : "rgba(255,255,255,0.2)",
                                                  }}
                                                  title={t.任務完成 ? "點擊取消" : "點擊完成"}
                                                >
                                                  {t.任務完成 ? <span className="text-sm text-amber-800">✓</span> : null}
                                                </button>
                                              </td>
                                            </tr>
                                          ))
                                        )}
                                      </tbody>
                                    </table>
                                  </div>
                                  {addingTaskFor === pid ? (
                                    <form
                                      className="flex flex-wrap items-end gap-3 rounded-lg border border-amber-200 bg-amber-500/5 p-4"
                                      onSubmit={async (e) => {
                                        e.preventDefault();
                                        setAddTaskError(null);
                                        if (!newTaskForm.任務名稱.trim()) {
                                          setAddTaskError("請填寫任務名稱");
                                          return;
                                        }
                                        setAddingTask(true);
                                        try {
                                          const res = await fetch("/api/tasks", {
                                            method: "POST",
                                            headers: { "Content-Type": "application/json" },
                                            body: JSON.stringify({
                                              專案ID: pid,
                                              專案名稱: row.專案名稱 ?? "",
                                              任務名稱: newTaskForm.任務名稱.trim(),
                                              任務狀態: newTaskForm.任務狀態.trim() || null,
                                              負責人: newTaskForm.任務負責人.trim() || null,
                                            }),
                                          });
                                          const data = (await safeResJson(res)) as { ok?: boolean; error?: string; task?: TaskRow };
                                          if (!res.ok || !data.ok) {
                                            setAddTaskError(data.error ?? "新增失敗");
                                            setAddingTask(false);
                                            return;
                                          }
                                          setTasks((prev) => [data.task!, ...prev]);
                                          setNewTaskForm({ 任務名稱: "", 任務狀態: "", 任務負責人: "" });
                                          setAddingTaskFor(null);
                                        } catch (err: unknown) {
                                          setAddTaskError(err instanceof Error ? err.message : "新增失敗");
                                        }
                                        setAddingTask(false);
                                      }}
                                    >
                                      {addTaskError && <p className="w-full text-sm text-amber-800">{addTaskError}</p>}
                                      <div>
                                        <label className="mb-1 block text-xs font-semibold text-stone-500">任務名稱</label>
                                        <input
                                          type="text"
                                          value={newTaskForm.任務名稱}
                                          onChange={(e) => setNewTaskForm((f) => ({ ...f, 任務名稱: e.target.value }))}
                                          className="w-64 rounded-lg border border-stone-300 bg-stone-100 px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-400/70 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
                                          placeholder="輸入任務內容"
                                        />
                                      </div>
                                      <div>
                                        <label className="mb-1 block text-xs font-semibold text-stone-500">狀態</label>
                                        <input
                                          type="text"
                                          value={newTaskForm.任務狀態}
                                          onChange={(e) => setNewTaskForm((f) => ({ ...f, 任務狀態: e.target.value }))}
                                          className="w-28 rounded-lg border border-stone-300 bg-stone-100 px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-400/70 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
                                          placeholder="如：進行中"
                                        />
                                      </div>
                                      <div>
                                        <label className="mb-1 block text-xs font-semibold text-stone-500">任務負責人</label>
                                        <select
                                          value={newTaskForm.任務負責人}
                                          onChange={(e) => setNewTaskForm((f) => ({ ...f, 任務負責人: e.target.value }))}
                                          className="w-40 rounded-lg border border-stone-300 bg-stone-100 px-3 py-2 text-sm text-stone-900 focus:border-amber-400/70 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
                                        >
                                          <option value="">— 未指定 —</option>
                                          {userNames.map((name) => (
                                            <option key={name} value={name}>
                                              {name}
                                            </option>
                                          ))}
                                        </select>
                                      </div>
                                      <div className="flex gap-2">
                                        <button
                                          type="submit"
                                          disabled={addingTask}
                                          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-slate-900 shadow-lg shadow-amber-200/30 transition hover:bg-amber-400 disabled:opacity-60"
                                        >
                                          {addingTask ? "新增中…" : "儲存"}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setAddingTaskFor(null);
                                            setAddTaskError(null);
                                            setNewTaskForm({ 任務名稱: "", 任務狀態: "", 任務負責人: "" });
                                          }}
                                          className="rounded-lg border border-stone-300 bg-stone-50 px-4 py-2 text-sm font-semibold text-stone-600 transition hover:bg-stone-100"
                                        >
                                          取消
                                        </button>
                                      </div>
                                    </form>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setAddingTaskFor(pid);
                                        setAddTaskError(null);
                                        setNewTaskForm({ 任務名稱: "", 任務狀態: "", 任務負責人: "" });
                                      }}
                                      className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 transition hover:bg-amber-100/90"
                                    >
                                      + 新增任務
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {searchedMasterList.length > visibleMasterRows.length && (
              <p className="mt-2 text-right text-xs text-stone-500">載入中 {visibleMasterRows.length} / {searchedMasterList.length}</p>
            )}
          </section>
        )}

        {/* 系統設定（董事長/管理者）- 分潤、專案類型、Table 參考：改為只在「可見性與權限」分頁中顯示 */}
        {canEditVisibility && activeSection === "visibility" && (
          <section className="rounded-2xl border border-stone-200/90 bg-white/90 p-6 shadow-xl ring-1 ring-amber-100/60">
            <h2 className="mb-1 text-xl font-bold tracking-tight text-stone-900">系統設定</h2>
            <p className="mb-4 text-sm text-stone-500">分潤成數、專案類型等，修改後點擊儲存即可生效</p>

            <div className="space-y-6">
              {/* 分潤成數預設 */}
              <div className="rounded-xl border border-stone-200/90 bg-stone-50/90 p-4">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="font-semibold text-amber-800">分潤成數預設</h3>
                  <button
                    type="button"
                    disabled={savingConfig === "payout"}
                    onClick={async () => {
                      setSavingConfig("payout");
                      try {
                        const res = await fetch("/api/system-config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "master_payout_defaults", value: payoutDefaults }) });
                        const data = (await safeResJson(res)) as { ok?: boolean; config?: { master_payout_defaults: Record<string, string> } };
                        if (res.ok && data.ok && data.config) {
                          setSystemConfig((c) => c ? { ...c, master_payout_defaults: data.config!.master_payout_defaults } : null);
                          await refreshDashboardData(["systemConfig", "master", "payout", "finance"]);
                        }
                      } catch {}
                      setSavingConfig(null);
                    }}
                    className="rounded-lg bg-amber-100/90 px-3 py-1.5 text-xs font-bold text-amber-800 transition hover:bg-amber-200/60 disabled:opacity-60"
                  >
                    {savingConfig === "payout" ? "儲存中" : "儲存"}
                  </button>
                </div>
                <div className="space-y-4">
                  <div>
                    <p className="mb-2 text-xs font-medium text-stone-500">分潤模式 A（製作案、活動案）</p>
                    <div className="flex flex-wrap gap-x-6 gap-y-2">
                      {(["專案BDPM分潤成數", "專案引薦人分潤成數", "專案管理員分潤成數", "執行管理員分潤成數"] as const).map((k) => (
                        <div key={k} className="flex items-center gap-2">
                          <span className="text-xs text-stone-500">{k}</span>
                          <input
                            type="text"
                            value={payoutDefaults[k] ?? ""}
                            onChange={(e) => setSystemConfig((c) => {
                              const base = c ?? { master_payout_defaults: { ...MASTER_PAYOUT_DEFAULTS }, project_types: [...PROJECT_TYPES], role_visibility: {} };
                              return { ...base, master_payout_defaults: { ...base.master_payout_defaults, [k]: e.target.value } };
                            })}
                            className="w-16 rounded border border-stone-300 bg-stone-50 px-2 py-1 text-xs text-stone-900 focus:border-amber-400/70 focus:outline-none"
                            placeholder="10%"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-medium text-stone-500">分潤模式 B（廣告案）</p>
                    <div className="flex flex-wrap gap-x-6 gap-y-2">
                      {(["專案引薦人分潤成數", "經紀人分潤成數", "主管分潤成數", "KOL開發者分潤成數"] as const).map((k) => (
                        <div key={k} className="flex items-center gap-2">
                          <span className="text-xs text-stone-500">{k}</span>
                          <input
                            type="text"
                            value={payoutDefaults[k] ?? ""}
                            onChange={(e) => setSystemConfig((c) => {
                              const base = c ?? { master_payout_defaults: { ...MASTER_PAYOUT_DEFAULTS }, project_types: [...PROJECT_TYPES], role_visibility: {} };
                              return { ...base, master_payout_defaults: { ...base.master_payout_defaults, [k]: e.target.value } };
                            })}
                            className="w-16 rounded border border-stone-300 bg-stone-50 px-2 py-1 text-xs text-stone-900 focus:border-amber-400/70 focus:outline-none"
                            placeholder="2.5%"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* 分潤規則：同一人不重複計算（分模式 A / B） */}
              <div className="rounded-xl border border-stone-200/90 bg-stone-50/90 p-4">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="font-semibold text-amber-800">分潤規則（同一人不重複計算）</h3>
                  <button
                    type="button"
                    disabled={savingConfig === "payout_dedupe_rules"}
                    onClick={async () => {
                      setSavingConfig("payout_dedupe_rules");
                      try {
                        const res = await fetch("/api/system-config", {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ key: "payout_dedupe_rules", value: payoutDedupeRules }),
                        });
                        const data = (await safeResJson(res)) as { ok?: boolean; config?: { payout_dedupe_rules?: PayoutDedupeRulesByMode } };
                        if (res.ok && data.ok && data.config) {
                          setSystemConfig((c) => (c ? { ...c, payout_dedupe_rules: data.config!.payout_dedupe_rules } : null));
                          await refreshDashboardData(["systemConfig", "payout"]);
                        }
                      } catch {}
                      setSavingConfig(null);
                    }}
                    className="rounded-lg bg-amber-100/90 px-3 py-1.5 text-xs font-bold text-amber-800 transition hover:bg-amber-200/60 disabled:opacity-60"
                  >
                    {savingConfig === "payout_dedupe_rules" ? "儲存中" : "儲存"}
                  </button>
                </div>
                <p className="mb-4 text-xs text-stone-500">
                  設定「成對角色」規則：當指定角色為同一人時，只保留你選擇的角色（例如「專案BDPM、專案管理員同一人時只計算專案BDPM」）。
                  點「儲存」後會依目前大總表<strong className="text-stone-500">自動重算並更新所有專案的分潤表</strong>。
                </p>

                {[
                  {
                    mode: "mode_a" as const,
                    label: "模式 A（製作案、活動案）",
                    roles: ["專案BDPM", "專案引薦人", "專案管理員", "執行管理員"] as const,
                  },
                  {
                    mode: "mode_b" as const,
                    label: "模式 B（廣告業配）",
                    roles: ["專案引薦人", "經紀人", "主管", "KOL開發者"] as const,
                  },
                ].map(({ mode, label, roles }) => (
                  <div key={mode} className="mb-4 last:mb-0">
                    <p className="mb-2 text-xs font-medium text-stone-500">{label}</p>
                    <div className="space-y-2">
                      {payoutDedupeRules[mode].map((rule, idx) => (
                        <div key={idx} className="flex flex-wrap items-center gap-2 rounded-lg border border-stone-200/90 bg-white/90 px-3 py-2">
                          <span className="text-xs text-stone-500">當</span>
                          <span className="font-medium text-stone-600">{rule.roles.join("、")}</span>
                          <span className="text-xs text-stone-500">為同一人時 → 只計算</span>
                          <span className="font-semibold text-amber-800">{rule.keep}</span>
                          <button
                            type="button"
                            onClick={() =>
                              setSystemConfig((c) => {
                                const base = c ?? { master_payout_defaults: { ...MASTER_PAYOUT_DEFAULTS }, project_types: [...PROJECT_TYPES], role_visibility: {} };
                                const next = { ...payoutDedupeRules, [mode]: payoutDedupeRules[mode].filter((_, i) => i !== idx) };
                                return { ...base, payout_dedupe_rules: next };
                              })
                            }
                            className="ml-auto text-stone-500 hover:text-red-400"
                            title="刪除此規則"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-stone-500">新增：</span>
                      <select id={`new-dedupe-keep-${mode}`} className="rounded border border-stone-300 bg-stone-50 px-2 py-1 text-xs text-stone-900">
                        {roles.map((r) => (
                          <option key={r} value={r}>只計算 {r}</option>
                        ))}
                      </select>
                      <span className="text-xs text-stone-500">當</span>
                      {roles.map((r) => (
                        <label key={r} className="flex items-center gap-1 text-xs text-stone-600">
                          <input type="checkbox" className="rounded border-stone-300" id={`new-dedupe-role-${mode}-${r}`} />
                          {r}
                        </label>
                      ))}
                      <span className="text-xs text-stone-500">為同一人時</span>
                      <button
                        type="button"
                        onClick={() => {
                          const keepSelect = document.getElementById(`new-dedupe-keep-${mode}`) as HTMLSelectElement | null;
                          const selectedRoles = roles.filter((r) => (document.getElementById(`new-dedupe-role-${mode}-${r}`) as HTMLInputElement | null)?.checked);
                          const keep = (keepSelect?.value ?? roles[0]) as (typeof roles)[number];
                          if (selectedRoles.length < 2 || !selectedRoles.includes(keep)) return;
                          setSystemConfig((c) => {
                            const base = c ?? { master_payout_defaults: { ...MASTER_PAYOUT_DEFAULTS }, project_types: [...PROJECT_TYPES], role_visibility: {} };
                            const next = { ...payoutDedupeRules, [mode]: [...payoutDedupeRules[mode], { roles: selectedRoles, keep }] };
                            return { ...base, payout_dedupe_rules: next };
                          });
                          roles.forEach((r) => {
                            const el = document.getElementById(`new-dedupe-role-${mode}-${r}`) as HTMLInputElement | null;
                            if (el) el.checked = false;
                          });
                        }}
                        className="rounded bg-amber-100/90 px-2 py-1 text-xs font-medium text-amber-800 transition hover:bg-amber-200/60"
                      >
                        新增
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* 3. 專案類型 */}
              <div className="rounded-xl border border-stone-200/90 bg-stone-50/90 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-semibold text-amber-800">專案類型</h3>
                  <button
                    type="button"
                    disabled={savingConfig === "project_types"}
                    onClick={async () => {
                      setSavingConfig("project_types");
                      try {
                        const res = await fetch("/api/system-config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "project_types", value: projectTypesOptions }) });
                        const data = (await safeResJson(res)) as { ok?: boolean; config?: { project_types: string[] } };
                        if (res.ok && data.ok && data.config) {
                          setSystemConfig((c) => c ? { ...c, project_types: data.config!.project_types } : null);
                          await refreshDashboardData(["systemConfig", "master"]);
                        }
                      } catch {}
                      setSavingConfig(null);
                    }}
                    className="rounded-lg bg-amber-100/90 px-3 py-1.5 text-xs font-bold text-amber-800 transition hover:bg-amber-200/60 disabled:opacity-60"
                  >
                    {savingConfig === "project_types" ? "儲存中" : "儲存"}
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {projectTypesOptions.map((t, i) => (
                    <span key={t} className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-600">
                      {t}
                      <button type="button" onClick={() => setSystemConfig((c) => ({ ...(c ?? { master_payout_defaults: { ...MASTER_PAYOUT_DEFAULTS }, project_types: [...PROJECT_TYPES], role_visibility: {} }), project_types: projectTypesOptions.filter((_, j) => j !== i) }))} className="text-stone-500 hover:text-amber-800">×</button>
                    </span>
                  ))}
                  <input
                    type="text"
                    placeholder="+ 新增類型"
                    className="w-24 rounded border border-dashed border-stone-300 bg-transparent px-2 py-1 text-xs text-stone-500 placeholder:text-stone-400 focus:border-amber-400/70 focus:outline-none"
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      const v = (e.target as HTMLInputElement).value.trim();
                      if (v && !projectTypesOptions.includes(v)) { setSystemConfig((c) => ({ ...(c ?? { master_payout_defaults: { ...MASTER_PAYOUT_DEFAULTS }, project_types: [...PROJECT_TYPES], role_visibility: {} }), project_types: [...projectTypesOptions, v] })); (e.target as HTMLInputElement).value = ""; }
                    }}
                  />
                </div>
              </div>

              {/* 4. 專案權限設定 */}
              <div className="rounded-xl border border-stone-200/90 bg-stone-50/90 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-semibold text-amber-800">專案權限設定</h3>
                  <button
                    type="button"
                    disabled={savingConfig === "role_permissions"}
                    onClick={async () => {
                      setSavingConfig("role_permissions");
                      try {
                        const res = await fetch("/api/system-config", {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ key: "role_permissions", value: rolePermissions }),
                        });
                        const data = (await safeResJson(res)) as {
                          ok?: boolean;
                          config?: { role_permissions?: { master?: { create?: string[]; update?: string[]; delete?: string[] } } };
                        };
                        if (res.ok && data.ok && data.config) {
                          setSystemConfig((c) => (c ? { ...c, role_permissions: data.config!.role_permissions } : c));
                          await refreshDashboardData(["systemConfig"]);
                        }
                      } catch {
                        /* ignore */
                      }
                      setSavingConfig(null);
                    }}
                    className="rounded-lg bg-amber-100/90 px-3 py-1.5 text-xs font-bold text-amber-800 transition hover:bg-amber-200/60 disabled:opacity-60"
                  >
                    {savingConfig === "role_permissions" ? "儲存中" : "儲存"}
                  </button>
                </div>
                <p className="mb-2 text-xs text-stone-500">
                  勾選各角色可執行的操作。未勾選即沒有該操作權限。
                </p>
                <div className="space-y-2">
                  {[
                    { key: "create" as const, label: "新增專案" },
                    { key: "update" as const, label: "編輯專案" },
                    { key: "delete" as const, label: "刪除專案" },
                  ].map(({ key, label }) => (
                    <div key={key} className="flex items-center gap-3">
                      <span className="w-20 text-xs font-medium text-stone-500">{label}</span>
                      <div className="flex flex-wrap gap-2">
                        {displayRoles.map((role) => {
                          const checked = rolePermissions.master[key].includes(role);
                          return (
                            <label key={role} className="inline-flex items-center gap-1 rounded-full bg-stone-50 px-2.5 py-1 text-xs text-stone-700">
                              <input
                                type="checkbox"
                                className="h-3.5 w-3.5 rounded border-stone-300 bg-white text-amber-600"
                                checked={checked}
                                onChange={(e) => {
                                  const nextList = checked
                                    ? rolePermissions.master[key].filter((r) => r !== role)
                                    : [...rolePermissions.master[key], role];
                                  setSystemConfig((c) => {
                                    const base = c ?? {
                                      master_payout_defaults: { ...MASTER_PAYOUT_DEFAULTS },
                                      project_types: [...PROJECT_TYPES],
                                      role_visibility: {},
                                      roles: [...displayRoles],
                                    };
                                    const current = (base as unknown as { role_permissions?: { master?: { create?: string[]; update?: string[]; delete?: string[] } } }).role_permissions ?? rolePermissions;
                                    return {
                                      ...base,
                                      role_permissions: {
                                        master: {
                                          ...current.master,
                                          [key]: nextList,
                                        },
                                      },
                                    };
                                  });
                                }}
                              />
                              <span>{role}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Table 欄位（唯讀參考） */}
              <div className="rounded-xl border border-stone-200/90 bg-stone-50/90 p-4">
                <h3 className="mb-2 font-semibold text-amber-800">Table 欄位參考</h3>
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-stone-500">
                  {TABLE_KEYS.map((tk) => (
                    <span key={tk}>{TABLE_LABELS[tk] ?? tk}: {(TABLE_COLUMNS[tk] ?? []).map((c) => c.key).join(", ")}</span>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

      {/* 新增使用者 Modal */}
      {showCreateUser && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-stone-900/30 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-stone-200/90 bg-white shadow-2xl ring-1 ring-stone-200/80">
            <header className="flex items-center justify-between border-b border-stone-200/90 bg-stone-100/90 px-6 py-4">
              <h2 className="text-xl font-bold tracking-tight text-stone-900">新增使用者</h2>
              <button
                type="button"
                onClick={() => {
                  setShowCreateUser(false);
                  setCreateUserError(null);
                }}
                className="rounded-xl border border-stone-300 bg-stone-50 px-4 py-2 text-sm font-semibold text-stone-600 transition hover:bg-amber-50 hover:text-amber-800"
              >
                關閉
              </button>
            </header>
            <form
              className="p-6"
              onSubmit={async (e) => {
                e.preventDefault();
                setCreateUserError(null);
                const email = createUserForm.email.trim().toLowerCase();
                if (!email || !createUserForm.name.trim() || !createUserForm.password.trim()) {
                  setCreateUserError("帳號、姓名、密碼為必填");
                  return;
                }
                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                  setCreateUserError("帳號必須為有效的 Email 格式（供發信通知使用）");
                  return;
                }
                setCreatingUser(true);
                try {
                  const res = await fetch("/api/users", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ...createUserForm, email }),
                  });
                  const data = (await safeResJson(res)) as { ok?: boolean; error?: string; user?: User };
                  if (!res.ok || !data.ok) {
                    setCreateUserError(data.error ?? "新增失敗");
                    setCreatingUser(false);
                    return;
                  }
                  setUsers((prev) => [data.user!, ...prev]);
                  setShowCreateUser(false);
                  setCreatingUser(false);
                } catch (err) {
                  setCreateUserError(err instanceof Error ? err.message : "新增失敗");
                  setCreatingUser(false);
                }
              }}
            >
              {createUserError && (
                <p className="mb-4 rounded-lg bg-amber-100/90 px-3 py-2 text-sm font-medium text-amber-800">{createUserError}</p>
              )}
              <div className="space-y-4">
                <InputField label="帳號 (Email)" type="email" value={createUserForm.email} onChange={(v) => setCreateUserForm((f) => ({ ...f, email: v }))} />
                <InputField label="姓名" value={createUserForm.name} onChange={(v) => setCreateUserForm((f) => ({ ...f, name: v }))} />
                <InputField label="密碼" type="password" value={createUserForm.password} onChange={(v) => setCreateUserForm((f) => ({ ...f, password: v }))} />
                <SelectField
                  label="角色"
                  value={displayRoles.includes(createUserForm.role) ? createUserForm.role : (displayRoles[0] ?? "經紀人")}
                  onChange={(v) => setCreateUserForm((f) => ({ ...f, role: v }))}
                  options={[...displayRoles]}
                />
                <InputField label="部門" value={createUserForm.dept} onChange={(v) => setCreateUserForm((f) => ({ ...f, dept: v }))} />
                <InputField label="責任範圍 (scope)" value={createUserForm.scope} onChange={(v) => setCreateUserForm((f) => ({ ...f, scope: v }))} />
              </div>
              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateUser(false);
                    setCreateUserError(null);
                  }}
                  className="rounded-xl border border-stone-300 bg-stone-50 px-4 py-2.5 text-sm font-semibold text-stone-600 transition hover:bg-stone-100"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={creatingUser}
                  className="rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-bold text-slate-900 shadow-lg shadow-amber-200/30 transition hover:bg-amber-400 disabled:opacity-60"
                >
                  {creatingUser ? "新增中..." : "新增"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 新增合作夥伴 / KOL Modal */}
      {showCreatePartner && (
        <div className="fixed inset-0 z-40 flex items-center justify中心 bg-stone-900/30 backdrop-blur-sm p-4">
          <div className="w-full max-w-3xl rounded-2xl border border-stone-200/90 bg-white shadow-2xl ring-1 ring-stone-200/80">
            <form
              className="flex max-h-[90vh] flex-col"
              onSubmit={async (e) => {
                e.preventDefault();
                setCreatePartnerError(null);
                if (!createPartnerForm.PartnerID.trim()) {
                  setCreatePartnerError("PartnerID 未取得，請關閉後再開啟新增或重新整理");
                  return;
                }
                if (!createPartnerForm.合作夥伴名稱.trim()) {
                  setCreatePartnerError("合作夥伴名稱 為必填");
                  return;
                }
                setCreatingPartner(true);
                try {
                  const res = await fetch("/api/partners", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(createPartnerForm),
                  });
                  const data = (await safeResJson(res)) as {
                    ok?: boolean;
                    error?: string;
                    partner?: PartnerRow;
                    pending?: boolean;
                    message?: string;
                  };
                  if (!res.ok || !data.ok || !data.partner) {
                    setCreatePartnerError(data.error ?? "新增失敗");
                    setCreatingPartner(false);
                    return;
                  }
                  if (data.pending) {
                    setPartnersPending((prev) => [data.partner!, ...prev]);
                    setPartnersTab("pending");
                    setCreatePartnerError(null);
                    setShowCreatePartner(false);
                    setCreatingPartner(false);
                    if (data.message) window.alert(data.message);
                    return;
                  }
                  setPartners((prev) => [data.partner!, ...prev]);
                  setShowCreatePartner(false);
                  setCreatingPartner(false);
                } catch (err) {
                  setCreatePartnerError(err instanceof Error ? err.message : "新增失敗");
                  setCreatingPartner(false);
                }
              }}
            >
              <header className="flex items-center justify-between border-b border-stone-200/90 bg-stone-100/90 px-6 py-4">
                <h2 className="text-xl font-bold tracking-tight text-stone-900">新增合作夥伴 / KOL</h2>
                <button
                  type="button"
                  onClick={() => {
                    setShowCreatePartner(false);
                    setCreatePartnerError(null);
                  }}
                  className="rounded-xl border border-stone-300 bg-stone-50 px-4 py-2 text-sm font-semibold text-stone-600 transition hover:bg-amber-50 hover:text-amber-800"
                >
                  關閉
                </button>
              </header>
              <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4 text-sm text-stone-800">
                {createPartnerError && (
                  <p className="mb-2 rounded-lg bg-amber-100/90 px-3 py-2 text-xs font-medium text-amber-800">{createPartnerError}</p>
                )}
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-stone-500">PartnerID（自動編號 KOL-001 起）*</label>
                    <input
                      type="text"
                      value={createPartnerForm.PartnerID}
                      readOnly
                      className="w-full rounded-lg border border-stone-200/90 bg-stone-100 px-3 py-1.5 text-sm text-stone-600"
                      title="依資料庫現有 KOL-編號遞增，無需手填"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-stone-500">合作夥伴名稱 *</label>
                    <input
                      type="text"
                      value={createPartnerForm.合作夥伴名稱}
                      onChange={(e) => setCreatePartnerForm((f) => ({ ...f, 合作夥伴名稱: e.target.value }))}
                      className="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-1.5 text-sm text-stone-900"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-stone-500">類別一</label>
                    <select
                      value={createPartnerForm.類別一}
                      onChange={(e) => setCreatePartnerForm((f) => ({ ...f, 類別一: e.target.value }))}
                      className="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-1.5 text-sm text-stone-900"
                    >
                      <option value="">— 請選擇 —</option>
                      {createPartnerForm.類別一 &&
                        !partnerFormOptions?.categories.類別一.includes(createPartnerForm.類別一) && (
                          <option value={createPartnerForm.類別一}>{createPartnerForm.類別一}（目前值）</option>
                        )}
                      {(partnerFormOptions?.categories.類別一 ?? []).map((v) => (
                        <option key={`c1-${v}`} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-stone-500">類別二</label>
                    <select
                      value={createPartnerForm.類別二}
                      onChange={(e) => setCreatePartnerForm((f) => ({ ...f, 類別二: e.target.value }))}
                      className="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-1.5 text-sm text-stone-900"
                    >
                      <option value="">— 請選擇 —</option>
                      {createPartnerForm.類別二 &&
                        !partnerFormOptions?.categories.類別二.includes(createPartnerForm.類別二) && (
                          <option value={createPartnerForm.類別二}>{createPartnerForm.類別二}（目前值）</option>
                        )}
                      {(partnerFormOptions?.categories.類別二 ?? []).map((v) => (
                        <option key={`c2-${v}`} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-stone-500">類別三</label>
                    <select
                      value={createPartnerForm.類別三}
                      onChange={(e) => setCreatePartnerForm((f) => ({ ...f, 類別三: e.target.value }))}
                      className="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-1.5 text-sm text-stone-900"
                    >
                      <option value="">— 請選擇 —</option>
                      {createPartnerForm.類別三 &&
                        !partnerFormOptions?.categories.類別三.includes(createPartnerForm.類別三) && (
                          <option value={createPartnerForm.類別三}>{createPartnerForm.類別三}（目前值）</option>
                        )}
                      {(partnerFormOptions?.categories.類別三 ?? []).map((v) => (
                        <option key={`c3-${v}`} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-stone-500">社群網站</label>
                    <textarea
                      value={createPartnerForm.社群網站}
                      onChange={(e) => setCreatePartnerForm((f) => ({ ...f, 社群網站: e.target.value }))}
                      placeholder="一行一個網址（支援 Facebook、Instagram、YouTube、Line、LinkedIn 等）"
                      rows={3}
                      className="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-1.5 text-sm text-stone-900 placeholder:text-stone-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-stone-500">粉絲數</label>
                    <input
                      type="text"
                      value={createPartnerForm.粉絲數}
                      onChange={(e) => setCreatePartnerForm((f) => ({ ...f, 粉絲數: e.target.value }))}
                      className="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-1.5 text-sm text-stone-900"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-stone-500">頻道｜節目名稱</label>
                    <input
                      type="text"
                      value={createPartnerForm["頻道｜節目名稱"]}
                      onChange={(e) => setCreatePartnerForm((f) => ({ ...f, "頻道｜節目名稱": e.target.value }))}
                      className="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-1.5 text-sm text-stone-900"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-stone-500">資料夾</label>
                    <input
                      type="text"
                      value={createPartnerForm.資料夾}
                      onChange={(e) => setCreatePartnerForm((f) => ({ ...f, 資料夾: e.target.value }))}
                      className="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-1.5 text-sm text-stone-900"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-stone-500">經紀人</label>
                    <input
                      type="text"
                      value={createPartnerForm.經紀人}
                      onChange={(e) => setCreatePartnerForm((f) => ({ ...f, 經紀人: e.target.value }))}
                      className="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-1.5 text-sm text-stone-900"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-stone-500">
                      KOL開發者（來自 Users）{!canEditVisibility && "— 僅董事長／管理者可指定"}
                    </label>
                    {canEditVisibility ? (
                      <select
                        value={createPartnerForm.KOL開發者}
                        onChange={(e) => setCreatePartnerForm((f) => ({ ...f, KOL開發者: e.target.value }))}
                        className="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-1.5 text-sm text-stone-900"
                      >
                        <option value="">— 請選擇 —</option>
                        {createPartnerForm.KOL開發者 &&
                          !(partnerFormOptions?.users ?? []).some(
                            (u) => u.name === createPartnerForm.KOL開發者 || u.email === createPartnerForm.KOL開發者
                          ) && (
                            <option value={createPartnerForm.KOL開發者}>
                              {createPartnerForm.KOL開發者}（目前值）
                            </option>
                          )}
                        {(partnerFormOptions?.users ?? []).map((u) => (
                          <option key={u.email} value={u.name}>
                            {u.name} ({u.email})
                          </option>
                        ))}
                      </select>
                    ) : (
                      <p className="rounded-lg border border-stone-200/90 bg-stone-50 px-3 py-1.5 text-sm text-stone-500">
                        核准後由董事長指定
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-stone-500">主管（分潤模式 B 用）</label>
                    <input
                      type="text"
                      value={createPartnerForm.主管}
                      onChange={(e) => setCreatePartnerForm((f) => ({ ...f, 主管: e.target.value }))}
                      className="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-1.5 text-sm text-stone-900"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-stone-500">合約開始日期</label>
                    <input
                      type="text"
                      placeholder="例：2025-01-01"
                      value={createPartnerForm.合約開始日期}
                      onChange={(e) => setCreatePartnerForm((f) => ({ ...f, 合約開始日期: e.target.value }))}
                      className="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-1.5 text-sm text-stone-900"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-stone-500">Email</label>
                    <input
                      type="email"
                      value={createPartnerForm.Email}
                      onChange={(e) => setCreatePartnerForm((f) => ({ ...f, Email: e.target.value }))}
                      className="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-1.5 text-sm text-stone-900"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-stone-500">分級</label>
                    <input
                      type="text"
                      value={createPartnerForm.分級}
                      onChange={(e) => setCreatePartnerForm((f) => ({ ...f, 分級: e.target.value }))}
                      className="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-1.5 text-sm text-stone-900"
                    />
                  </div>
                </div>
                <div className="mt-2 grid gap-3 md:grid-cols-2">
                  <label className="inline-flex items-center gap-2 text-xs text-stone-700">
                    <input
                      type="checkbox"
                      checked={createPartnerForm["是否有經營 私域群"]}
                      onChange={(e) => setCreatePartnerForm((f) => ({ ...f, "是否有經營 私域群": e.target.checked }))}
                      className="h-4 w-4 rounded border-stone-300 bg-stone-50 text-amber-500"
                    />
                    是否有經營 私域群
                  </label>
                  <label className="inline-flex items-center gap-2 text-xs text-stone-700">
                    <input
                      type="checkbox"
                      checked={createPartnerForm.廣告經銷夥伴}
                      onChange={(e) => setCreatePartnerForm((f) => ({ ...f, 廣告經銷夥伴: e.target.checked }))}
                      className="h-4 w-4 rounded border-stone-300 bg-stone-50 text-amber-500"
                    />
                    廣告經銷夥伴
                  </label>
                  <label className="inline-flex items-center gap-2 text-xs text-stone-700">
                    <input
                      type="checkbox"
                      checked={createPartnerForm.節目製作夥伴}
                      onChange={(e) => setCreatePartnerForm((f) => ({ ...f, 節目製作夥伴: e.target.checked }))}
                      className="h-4 w-4 rounded border-stone-300 bg-stone-50 text-amber-500"
                    />
                    節目製作夥伴
                  </label>
                  <label className="inline-flex items-center gap-2 text-xs text-stone-700">
                    <input
                      type="checkbox"
                      checked={createPartnerForm.課程製作夥伴}
                      onChange={(e) => setCreatePartnerForm((f) => ({ ...f, 課程製作夥伴: e.target.checked }))}
                      className="h-4 w-4 rounded border-stone-300 bg-stone-50 text-amber-500"
                    />
                    課程製作夥伴
                  </label>
                </div>
              </div>
              <footer className="flex justify-end gap-3 border-t border-stone-200/90 bg-stone-100/90 px-6 py-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreatePartner(false);
                    setCreatePartnerError(null);
                  }}
                  className="rounded-xl border border-stone-300 bg-stone-50 px-4 py-2.5 text-sm font-semibold text-stone-600 transition hover:bg-stone-100"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={creatingPartner}
                  className="rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-bold text-slate-900 shadow-lg shadow-amber-200/30 transition hover:bg-amber-400 disabled:opacity-60"
                >
                  {creatingPartner ? "新增中..." : "新增 KOL"}
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}

      {/* 編輯 / 檢視合作夥伴 Modal */}
      {showEditPartner && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-stone-900/30 backdrop-blur-sm p-4">
          <div className="w-full max-w-3xl rounded-2xl border border-stone-200/90 bg-white shadow-2xl ring-1 ring-stone-200/80">
            <div className="flex max-h-[90vh] flex-col">
              <header className="flex items-center justify-between border-b border-stone-200/90 bg-stone-100/90 px-6 py-4">
                <h2 className="text-xl font-bold tracking-tight text-stone-900">
                  {canEditVisibility || canPartnerAgentSave ? "編輯合作夥伴 / KOL" : "合作夥伴詳情"}
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    setShowEditPartner(false);
                    setPartnerEditError(null);
                    setEditingPartnerSource(null);
                  }}
                  className="rounded-xl border border-stone-300 bg-stone-50 px-4 py-2 text-sm font-semibold text-stone-600 transition hover:bg-amber-50 hover:text-amber-800"
                >
                  關閉
                </button>
              </header>
              <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4 text-sm text-stone-800">
                {partnerEditError && (
                  <p className="mb-2 rounded-lg bg-amber-100/90 px-3 py-2 text-xs font-medium text-amber-800">{partnerEditError}</p>
                )}
                {showEditPartner && !canEditVisibility && !canPartnerAgentSave && editingPartnerSource && (
                  <p className="mb-2 rounded-lg border border-stone-200/90 bg-stone-100/90 px-3 py-2 text-xs text-stone-500">
                    待審核新申請僅<strong className="text-stone-600">建立者</strong>可編輯；已上架 KOL 修改會送
                    <strong className="text-amber-800"> 變更審核 </strong>
                    ，主列表不變，核准後才更新。
                  </p>
                )}
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-stone-500">PartnerID</label>
                    <input
                      type="text"
                      value={editPartnerForm.PartnerID}
                      readOnly
                      className="w-full rounded-lg border border-stone-200/90 bg-stone-100 px-3 py-1.5 text-sm text-stone-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-stone-500">
                      合作夥伴名稱 {(canEditVisibility || partnerFieldEditable("合作夥伴名稱")) && "*"}
                    </label>
                    {partnerFieldEditable("合作夥伴名稱") ? (
                      <input
                        type="text"
                        value={editPartnerForm.合作夥伴名稱}
                        onChange={(e) => setEditPartnerForm((f) => ({ ...f, 合作夥伴名稱: e.target.value }))}
                        className="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-1.5 text-sm text-stone-900"
                      />
                    ) : (
                      <p className="rounded-lg border border-stone-200/90 bg-stone-50 px-3 py-1.5 text-sm text-stone-700">{editPartnerForm.合作夥伴名稱 || "—"}</p>
                    )}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-stone-500">類別一</label>
                    {partnerFieldEditable("類別一") ? (
                      <select
                        value={editPartnerForm.類別一}
                        onChange={(e) => setEditPartnerForm((f) => ({ ...f, 類別一: e.target.value }))}
                        className="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-1.5 text-sm text-stone-900"
                      >
                        <option value="">— 請選擇 —</option>
                        {editPartnerForm.類別一 &&
                          !partnerFormOptions?.categories.類別一.includes(editPartnerForm.類別一) && (
                            <option value={editPartnerForm.類別一}>{editPartnerForm.類別一}（目前值）</option>
                          )}
                        {(partnerFormOptions?.categories.類別一 ?? []).map((v) => (
                          <option key={`e1-${v}`} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <p className="rounded-lg border border-stone-200/90 bg-stone-50 px-3 py-1.5 text-sm text-stone-700">{editPartnerForm.類別一 || "—"}</p>
                    )}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-stone-500">類別二</label>
                    {partnerFieldEditable("類別二") ? (
                      <select
                        value={editPartnerForm.類別二}
                        onChange={(e) => setEditPartnerForm((f) => ({ ...f, 類別二: e.target.value }))}
                        className="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-1.5 text-sm text-stone-900"
                      >
                        <option value="">— 請選擇 —</option>
                        {editPartnerForm.類別二 &&
                          !partnerFormOptions?.categories.類別二.includes(editPartnerForm.類別二) && (
                            <option value={editPartnerForm.類別二}>{editPartnerForm.類別二}（目前值）</option>
                          )}
                        {(partnerFormOptions?.categories.類別二 ?? []).map((v) => (
                          <option key={`e2-${v}`} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <p className="rounded-lg border border-stone-200/90 bg-stone-50 px-3 py-1.5 text-sm text-stone-700">{editPartnerForm.類別二 || "—"}</p>
                    )}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-stone-500">類別三</label>
                    {partnerFieldEditable("類別三") ? (
                      <select
                        value={editPartnerForm.類別三}
                        onChange={(e) => setEditPartnerForm((f) => ({ ...f, 類別三: e.target.value }))}
                        className="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-1.5 text-sm text-stone-900"
                      >
                        <option value="">— 請選擇 —</option>
                        {editPartnerForm.類別三 &&
                          !partnerFormOptions?.categories.類別三.includes(editPartnerForm.類別三) && (
                            <option value={editPartnerForm.類別三}>{editPartnerForm.類別三}（目前值）</option>
                          )}
                        {(partnerFormOptions?.categories.類別三 ?? []).map((v) => (
                          <option key={`e3-${v}`} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <p className="rounded-lg border border-stone-200/90 bg-stone-50 px-3 py-1.5 text-sm text-stone-700">{editPartnerForm.類別三 || "—"}</p>
                    )}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-stone-500">社群網站</label>
                    {partnerFieldEditable("社群網站") ? (
                      <textarea
                        value={editPartnerForm.社群網站}
                        onChange={(e) => setEditPartnerForm((f) => ({ ...f, 社群網站: e.target.value }))}
                        placeholder="一行一個網址"
                        rows={3}
                        className="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-1.5 text-sm text-stone-900 placeholder:text-stone-500"
                      />
                    ) : (
                      <p className="rounded-lg border border-stone-200/90 bg-stone-50 px-3 py-1.5 text-sm text-stone-700">
                        <SocialLinkIcons value={editPartnerForm.社群網站} />
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-stone-500">粉絲數</label>
                    {partnerFieldEditable("粉絲數") ? (
                      <input
                        type="text"
                        value={editPartnerForm.粉絲數}
                        onChange={(e) => setEditPartnerForm((f) => ({ ...f, 粉絲數: e.target.value }))}
                        className="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-1.5 text-sm text-stone-900"
                      />
                    ) : (
                      <p className="rounded-lg border border-stone-200/90 bg-stone-50 px-3 py-1.5 text-sm text-stone-700">{editPartnerForm.粉絲數 || "—"}</p>
                    )}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-stone-500">頻道｜節目名稱</label>
                    {partnerFieldEditable("頻道｜節目名稱") ? (
                      <input
                        type="text"
                        value={editPartnerForm["頻道｜節目名稱"]}
                        onChange={(e) => setEditPartnerForm((f) => ({ ...f, "頻道｜節目名稱": e.target.value }))}
                        className="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-1.5 text-sm text-stone-900"
                      />
                    ) : (
                      <p className="rounded-lg border border-stone-200/90 bg-stone-50 px-3 py-1.5 text-sm text-stone-700">{editPartnerForm["頻道｜節目名稱"] || "—"}</p>
                    )}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-stone-500">資料夾</label>
                    {partnerFieldEditable("資料夾") ? (
                      <input
                        type="text"
                        value={editPartnerForm.資料夾}
                        onChange={(e) => setEditPartnerForm((f) => ({ ...f, 資料夾: e.target.value }))}
                        className="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-1.5 text-sm text-stone-900"
                      />
                    ) : (
                      <p className="rounded-lg border border-stone-200/90 bg-stone-50 px-3 py-1.5 text-sm text-stone-700">{editPartnerForm.資料夾 || "—"}</p>
                    )}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-stone-500">經紀人</label>
                    {partnerFieldEditable("經紀人") ? (
                      <input
                        type="text"
                        value={editPartnerForm.經紀人}
                        onChange={(e) => setEditPartnerForm((f) => ({ ...f, 經紀人: e.target.value }))}
                        className="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-1.5 text-sm text-stone-900"
                      />
                    ) : (
                      <p className="rounded-lg border border-stone-200/90 bg-stone-50 px-3 py-1.5 text-sm text-stone-700">{editPartnerForm.經紀人 || "—"}</p>
                    )}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-stone-500">
                      KOL開發者（來自 Users）{!canEditVisibility && "— 僅董事長可改"}
                    </label>
                    {partnerFieldEditable("KOL開發者") ? (
                      <select
                        value={editPartnerForm.KOL開發者}
                        onChange={(e) => setEditPartnerForm((f) => ({ ...f, KOL開發者: e.target.value }))}
                        className="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-1.5 text-sm text-stone-900"
                      >
                        <option value="">— 請選擇 —</option>
                        {editPartnerForm.KOL開發者 &&
                          !(partnerFormOptions?.users ?? []).some(
                            (u) => u.name === editPartnerForm.KOL開發者 || u.email === editPartnerForm.KOL開發者
                          ) && (
                            <option value={editPartnerForm.KOL開發者}>{editPartnerForm.KOL開發者}（目前值）</option>
                          )}
                        {(partnerFormOptions?.users ?? []).map((u) => (
                          <option key={u.email} value={u.name}>
                            {u.name} ({u.email})
                          </option>
                        ))}
                      </select>
                    ) : (
                      <p className="rounded-lg border border-stone-200/90 bg-stone-50 px-3 py-1.5 text-sm text-stone-700">{editPartnerForm.KOL開發者 || "—"}</p>
                    )}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-stone-500">主管（分潤模式 B 用）</label>
                    {partnerFieldEditable("主管") ? (
                      <input
                        type="text"
                        value={editPartnerForm.主管}
                        onChange={(e) => setEditPartnerForm((f) => ({ ...f, 主管: e.target.value }))}
                        className="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-1.5 text-sm text-stone-900"
                      />
                    ) : (
                      <p className="rounded-lg border border-stone-200/90 bg-stone-50 px-3 py-1.5 text-sm text-stone-700">{editPartnerForm.主管 || "—"}</p>
                    )}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-stone-500">合約開始日期</label>
                    {partnerFieldEditable("合約開始日期") ? (
                      <input
                        type="text"
                        placeholder="例：2025-01-01"
                        value={editPartnerForm.合約開始日期}
                        onChange={(e) => setEditPartnerForm((f) => ({ ...f, 合約開始日期: e.target.value }))}
                        className="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-1.5 text-sm text-stone-900"
                      />
                    ) : (
                      <p className="rounded-lg border border-stone-200/90 bg-stone-50 px-3 py-1.5 text-sm text-stone-700">{editPartnerForm.合約開始日期 || "—"}</p>
                    )}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-stone-500">Email</label>
                    {partnerFieldEditable("Email") ? (
                      <input
                        type="email"
                        value={editPartnerForm.Email}
                        onChange={(e) => setEditPartnerForm((f) => ({ ...f, Email: e.target.value }))}
                        className="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-1.5 text-sm text-stone-900"
                      />
                    ) : (
                      <p className="rounded-lg border border-stone-200/90 bg-stone-50 px-3 py-1.5 text-sm text-stone-700">{editPartnerForm.Email || "—"}</p>
                    )}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-stone-500">分級</label>
                    {partnerFieldEditable("分級") ? (
                      <input
                        type="text"
                        value={editPartnerForm.分級}
                        onChange={(e) => setEditPartnerForm((f) => ({ ...f, 分級: e.target.value }))}
                        className="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-1.5 text-sm text-stone-900"
                      />
                    ) : (
                      <p className="rounded-lg border border-stone-200/90 bg-stone-50 px-3 py-1.5 text-sm text-stone-700">{editPartnerForm.分級 || "—"}</p>
                    )}
                  </div>
                </div>
                <div className="mt-2 grid gap-3 md:grid-cols-2">
                  <label className="inline-flex items-center gap-2 text-xs text-stone-700">
                    {partnerFieldEditable("是否有經營 私域群") ? (
                      <input
                        type="checkbox"
                        checked={editPartnerForm["是否有經營 私域群"]}
                        onChange={(e) => setEditPartnerForm((f) => ({ ...f, "是否有經營 私域群": e.target.checked }))}
                        className="h-4 w-4 rounded border-stone-300 bg-stone-50 text-amber-500"
                      />
                    ) : (
                      <span className="text-amber-800">{editPartnerForm["是否有經營 私域群"] ? "✓" : "—"}</span>
                    )}
                    是否有經營 私域群
                  </label>
                  <label className="inline-flex items-center gap-2 text-xs text-stone-700">
                    {partnerFieldEditable("廣告經銷夥伴") ? (
                      <input
                        type="checkbox"
                        checked={editPartnerForm.廣告經銷夥伴}
                        onChange={(e) => setEditPartnerForm((f) => ({ ...f, 廣告經銷夥伴: e.target.checked }))}
                        className="h-4 w-4 rounded border-stone-300 bg-stone-50 text-amber-500"
                      />
                    ) : (
                      <span className="text-amber-800">{editPartnerForm.廣告經銷夥伴 ? "✓" : "—"}</span>
                    )}
                    廣告經銷夥伴
                  </label>
                  <label className="inline-flex items-center gap-2 text-xs text-stone-700">
                    {partnerFieldEditable("節目製作夥伴") ? (
                      <input
                        type="checkbox"
                        checked={editPartnerForm.節目製作夥伴}
                        onChange={(e) => setEditPartnerForm((f) => ({ ...f, 節目製作夥伴: e.target.checked }))}
                        className="h-4 w-4 rounded border-stone-300 bg-stone-50 text-amber-500"
                      />
                    ) : (
                      <span className="text-amber-800">{editPartnerForm.節目製作夥伴 ? "✓" : "—"}</span>
                    )}
                    節目製作夥伴
                  </label>
                  <label className="inline-flex items-center gap-2 text-xs text-stone-700">
                    {partnerFieldEditable("課程製作夥伴") ? (
                      <input
                        type="checkbox"
                        checked={editPartnerForm.課程製作夥伴}
                        onChange={(e) => setEditPartnerForm((f) => ({ ...f, 課程製作夥伴: e.target.checked }))}
                        className="h-4 w-4 rounded border-stone-300 bg-stone-50 text-amber-500"
                      />
                    ) : (
                      <span className="text-amber-800">{editPartnerForm.課程製作夥伴 ? "✓" : "—"}</span>
                    )}
                    課程製作夥伴
                  </label>
                </div>
              </div>
              {(canEditVisibility || canPartnerAgentSave) && (
                <footer className="flex flex-col gap-2 border-t border-stone-200/90 bg-stone-100/90 px-6 py-4">
                  {!canEditVisibility &&
                    editingPartnerSource &&
                    (editingPartnerSource.審核狀態 ?? PARTNER_STATUS.APPROVED) === PARTNER_STATUS.APPROVED && (
                    <p className="text-xs text-amber-800">
                      儲存後會送出<strong className="text-amber-700"> 變更審核 </strong>
                      ，主列表資料維持不變；董事長核准後才會套用修改。
                    </p>
                  )}
                  <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setShowEditPartner(false);
                      setPartnerEditError(null);
                      setEditingPartnerSource(null);
                    }}
                    className="rounded-xl border border-stone-300 bg-stone-50 px-4 py-2.5 text-sm font-semibold text-stone-600 transition hover:bg-stone-100"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={savingPartner}
                    onClick={async () => {
                      setPartnerEditError(null);
                      const status = editingPartnerSource?.審核狀態 ?? PARTNER_STATUS.APPROVED;
                      const needName =
                        canEditVisibility ||
                        status === PARTNER_STATUS.PENDING ||
                        status === PARTNER_STATUS.REJECTED;
                      if (needName && !editPartnerForm.合作夥伴名稱.trim()) {
                        setPartnerEditError("合作夥伴名稱為必填");
                        return;
                      }
                      setSavingPartner(true);
                      try {
                        const fullBody = {
                            PartnerID: editPartnerForm.PartnerID,
                            類別一: editPartnerForm.類別一 || undefined,
                            類別二: editPartnerForm.類別二 || undefined,
                            類別三: editPartnerForm.類別三 || undefined,
                            合作夥伴名稱: editPartnerForm.合作夥伴名稱,
                            社群網站: editPartnerForm.社群網站 || undefined,
                            粉絲數: editPartnerForm.粉絲數 || undefined,
                            "頻道｜節目名稱": editPartnerForm["頻道｜節目名稱"] || undefined,
                            "是否有經營 私域群": editPartnerForm["是否有經營 私域群"],
                            資料夾: editPartnerForm.資料夾 || undefined,
                            經紀人: editPartnerForm.經紀人 || undefined,
                            KOL開發者: editPartnerForm.KOL開發者 || undefined,
                            主管: editPartnerForm.主管 || undefined,
                            合約開始日期: editPartnerForm.合約開始日期 || undefined,
                            廣告經銷夥伴: editPartnerForm.廣告經銷夥伴,
                            節目製作夥伴: editPartnerForm.節目製作夥伴,
                            課程製作夥伴: editPartnerForm.課程製作夥伴,
                            Email: editPartnerForm.Email || undefined,
                            分級: editPartnerForm.分級 || undefined,
                        };
                        // 經紀人不可改 KOL開發者：不送該欄位，API 亦會過濾
                        const patchBody = { ...fullBody } as Record<string, unknown>;
                        if (!canEditVisibility) delete patchBody.KOL開發者;
                        const res = await fetch("/api/partners", {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify(patchBody),
                        });
                        const data = (await safeResJson(res)) as {
                          ok?: boolean;
                          error?: string;
                          partner?: PartnerRow;
                          changeRequest?: { id: string };
                          reAudit?: boolean;
                          message?: string;
                        };
                        if (!res.ok || !data.ok || !data.partner) {
                          setPartnerEditError(data.error ?? "更新失敗");
                          setSavingPartner(false);
                          return;
                        }
                        const updated = data.partner!;
                        if (data.changeRequest && data.reAudit) {
                          /** 已上架 KOL：變更進審核，主表不變 */
                          if (data.message) window.alert(data.message);
                          fetchPartnersPending();
                          setPartnersTab("pending");
                        } else if (updated.審核狀態 === PARTNER_STATUS.APPROVED) {
                          setPartners((prev) => {
                            const exists = prev.some((p) => p.PartnerID === updated.PartnerID);
                            if (exists) return prev.map((p) => (p.PartnerID === updated.PartnerID ? updated : p));
                            return [updated, ...prev];
                          });
                          setPartnersPending((prev) => prev.filter((p) => p.PartnerID !== updated.PartnerID));
                        } else {
                          setPartnersPending((prev) => {
                            const exists = prev.some((p) => p.PartnerID === updated.PartnerID);
                            if (exists) return prev.map((p) => (p.PartnerID === updated.PartnerID ? updated : p));
                            return [updated, ...prev];
                          });
                          if (data.reAudit && data.message) window.alert(data.message);
                          setPartnersTab("pending");
                        }
                        setShowEditPartner(false);
                        setExpandedPartnerId(null);
                        setEditingPartnerSource(null);
                        setSavingPartner(false);
                      } catch (err) {
                        setPartnerEditError(err instanceof Error ? err.message : "更新失敗");
                        setSavingPartner(false);
                      }
                    }}
                    className="rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-bold text-slate-900 shadow-lg shadow-amber-200/30 transition hover:bg-amber-400 disabled:opacity-60"
                  >
                    {savingPartner ? "儲存中..." : "儲存"}
                  </button>
                  </div>
                </footer>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 變更申請差異（舊值 / 新值 標色） */}
      {showChangeRequestDiff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-xl">
            <header className="flex items-center justify-between border-b border-stone-200/90 px-4 py-3">
              <h3 className="text-lg font-bold text-stone-900">
                變更差異 — {showChangeRequestDiff.PartnerID}
              </h3>
              <button
                type="button"
                onClick={() => setShowChangeRequestDiff(null)}
                className="rounded-lg border border-stone-300 px-3 py-1 text-sm text-stone-600 hover:bg-stone-100"
              >
                關閉
              </button>
            </header>
            <div className="max-h-[65vh] overflow-y-auto p-4 text-sm">
              <p className="mb-3 text-xs text-stone-500">
                僅<strong className="text-amber-800">有差異</strong>的欄位會以
                <span className="mx-1 rounded bg-red-500/20 px-1.5 py-0.5 text-red-300">變更前</span>
                /
                <span className="mx-1 rounded bg-emerald-500/20 px-1.5 py-0.5 text-emerald-300">變更後</span>
                標色；其餘未變更的不列入。
              </p>
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-stone-200/90 text-xs text-stone-500">
                    <th className="py-2 pr-2">欄位</th>
                    <th className="py-2 pr-2">變更前</th>
                    <th className="py-2">變更後</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const rows = Object.entries(showChangeRequestDiff.變更內容)
                      .map(([key, newVal]) => {
                        const oldVal = showChangeRequestDiff.變更前快照?.[key];
                        const label = tableColumnLabels.partners?.[key] ?? key;
                        const oldStr = oldVal === undefined || oldVal === null ? "—" : String(oldVal);
                        const newStr = newVal === undefined || newVal === null ? "—" : String(newVal);
                        const same =
                          oldStr === newStr ||
                          (typeof oldVal === "boolean" &&
                            typeof newVal === "boolean" &&
                            oldVal === newVal);
                        return { key, label, oldStr, newStr, same };
                      })
                      .filter((r) => !r.same);
                    if (rows.length === 0) {
                      return (
                        <tr>
                          <td colSpan={3} className="py-6 text-center text-stone-500">
                            此申請與目前上架資料比對無差異（或僅送出未改動欄位）。
                          </td>
                        </tr>
                      );
                    }
                    return rows.map((r) => (
                      <tr key={r.key} className="border-b border-stone-200/70 align-top">
                        <td className="py-2 pr-2 font-medium text-stone-600">{r.label}</td>
                        <td className="py-2 pr-2 rounded bg-red-500/15 text-red-100">{r.oldStr}</td>
                        <td className="py-2 rounded bg-emerald-500/15 text-emerald-100">{r.newStr}</td>
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

        {/* 合作夥伴 / KOL */}
        {activeSection === "partners" && (
        <section className="rounded-2xl border border-stone-200/90 bg-white/90 p-4 shadow-xl ring-1 ring-amber-100/60 sm:p-6">
          {partnersLoadError && (
            <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-200">
              <p className="font-semibold text-amber-700">合作夥伴列表載入異常（已嘗試備援查詢）</p>
              <p className="mt-1 text-xs text-amber-200/90">{partnersLoadError}</p>
              <p className="mt-2 text-xs text-stone-500">若仍無資料，請在 Supabase 確認 public.partners 欄位名是否與程式一致，或表內是否有列。</p>
            </div>
          )}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-xl font-bold tracking-tight text-stone-900">合作夥伴 / KOL</h2>
              <div className="flex rounded-lg border border-stone-200 bg-white/90 p-0.5">
                <button
                  type="button"
                  onClick={() => setPartnersTab("approved")}
                  className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
                    partnersTab === "approved" ? "bg-amber-500 text-slate-900" : "text-stone-500 hover:text-stone-900"
                  }`}
                >
                  已上架
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPartnersTab("pending");
                    fetchPartnersPending();
                  }}
                  className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
                    partnersTab === "pending" ? "bg-amber-500 text-slate-900" : "text-stone-500 hover:text-stone-900"
                  }`}
                >
                  待審核
                  {(partnersPending.length > 0 || partnerChangeRequests.length > 0) && (
                    <span className="ml-1 rounded-full bg-amber-200/80 px-1.5 py-0.5 text-[10px] text-amber-800">
                      {partnersPending.length + partnerChangeRequests.length}
                    </span>
                  )}
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="text"
                value={partnersSearch}
                onChange={(e) => setPartnersSearch(e.target.value)}
                placeholder="搜尋 PartnerID、合作夥伴名稱、Email…"
                className="w-60 rounded-full border border-stone-200 bg-stone-50 px-3.5 py-1.5 text-xs text-stone-800 placeholder:text-stone-500 focus:border-amber-500/60 focus:outline-none"
              />
              <>
                  {canEditVisibility && (
                  <button
                    type="button"
                    disabled={refreshingFollowers}
                    onClick={async () => {
                      setRefreshFollowersMessage(null);
                      setRefreshingFollowers(true);
                      try {
                        const res = await fetch("/api/partners/refresh-followers", { method: "POST" });
                        const data = (await res.json()) as { ok?: boolean; updated?: number; errors?: { partnerId: string; url: string; message: string }[]; message?: string; error?: string };
                        if (data.ok) {
                          setRefreshFollowersMessage(data.message ?? `已更新 ${data.updated ?? 0} 位`);
                          const listRes = await fetch("/api/partners", { cache: "no-store" });
                          const listData = (await listRes.json()) as { partners?: PartnerRow[] };
                          if (Array.isArray(listData.partners)) setPartners(listData.partners);
                        } else {
                          setRefreshFollowersMessage(data.error ?? "更新失敗");
                        }
                      } catch (e) {
                        setRefreshFollowersMessage(e instanceof Error ? e.message : "更新失敗");
                      } finally {
                        setRefreshingFollowers(false);
                      }
                    }}
                    className="rounded-full border border-amber-500/60 bg-amber-50 px-4 py-1.5 text-xs font-bold text-amber-800 transition hover:bg-amber-100/90 disabled:opacity-60"
                  >
                    {refreshingFollowers ? "更新粉絲數中…" : "更新粉絲數"}
                  </button>
                  )}
                  <button
                    type="button"
                    onClick={async () => {
                      const opts = await fetchPartnerFormOptions();
                      setCreatePartnerForm({
                        PartnerID: opts?.nextPartnerId ?? "",
                        類別一: "",
                        類別二: "",
                        類別三: "",
                        合作夥伴名稱: "",
                        社群網站: "",
                        粉絲數: "",
                        "頻道｜節目名稱": "",
                        "是否有經營 私域群": false,
                        資料夾: "",
                        經紀人: me?.name ?? "",
                        KOL開發者: "",
                        主管: "",
                        合約開始日期: "",
                        廣告經銷夥伴: false,
                        節目製作夥伴: false,
                        課程製作夥伴: false,
                        Email: "",
                        分級: "",
                      });
                      setCreatePartnerError(null);
                      setShowCreatePartner(true);
                    }}
                    className="rounded-full bg-amber-500 px-4 py-1.5 text-xs font-bold text-slate-900 shadow shadow-amber-200/40 transition hover:bg-amber-400"
                  >
                    新增 KOL
                  </button>
              </>
            </div>
            {refreshFollowersMessage && (
              <p className="mt-2 text-xs text-amber-800">{refreshFollowersMessage}</p>
            )}
          </div>
          {/* 已上架：原主列表 */}
          {partnersTab === "approved" && (
          <>
          <div className="max-h-[60vh] overflow-y-auto overflow-x-auto rounded-xl border border-stone-200/90">
            <table className="min-w-full divide-y divide-stone-200">
              <thead className="sticky top-0 z-20 bg-amber-100/90">
                <tr>
                  <th className="w-10 px-2 py-3.5 text-left text-sm font-semibold tracking-wider text-amber-700 border-b border-amber-400/60" />
                  {partnerListCols.map((k) => (
                    <th
                      key={k}
                      className="px-4 py-3.5 text-left text-sm font-semibold tracking-wider text-amber-700 border-b border-amber-400/60"
                    >
                      {tableColumnLabels.partners?.[k] ?? k}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200 bg-amber-50/40">
                {partners.length === 0 ? (
                  <tr>
                    <td colSpan={(partnerListCols.length || 6) + 1} className="px-4 py-8 text-center text-base font-medium text-stone-500">
                      尚無合作夥伴資料
                    </td>
                  </tr>
                ) : searchedPartners.length === 0 ? (
                  <tr>
                    <td colSpan={(partnerListCols.length || 6) + 1} className="px-4 py-8 text-center text-base font-medium text-stone-500">
                      沒有符合搜尋結果
                    </td>
                  </tr>
                ) : (
                  visiblePartnersRows.flatMap((pt, i) => {
                    const pid = pt.PartnerID ?? "";
                    const expanded = expandedPartnerId === pid;
                    return [
                      <tr
                        key={pt.PartnerID ?? i}
                        onClick={() => {
                          setEditingPartnerSource(pt);
                          setEditPartnerForm({
                            PartnerID: pid,
                            類別一: String(pt.類別一 ?? ""),
                            類別二: String(pt.類別二 ?? ""),
                            類別三: String(pt.類別三 ?? ""),
                            合作夥伴名稱: String(pt.合作夥伴名稱 ?? ""),
                            社群網站: String(pt.社群網站 ?? ""),
                            粉絲數: String(pt.粉絲數 ?? ""),
                            "頻道｜節目名稱": String(pt["頻道｜節目名稱"] ?? ""),
                            "是否有經營 私域群": Boolean(pt["是否有經營 私域群"]),
                            資料夾: String(pt.資料夾 ?? ""),
                            經紀人: String(pt.經紀人 ?? ""),
                            KOL開發者: String(pt.KOL開發者 ?? ""),
                            主管: String(pt.主管 ?? ""),
                            合約開始日期: String(pt.合約開始日期 ?? ""),
                            廣告經銷夥伴: Boolean(pt.廣告經銷夥伴),
                            節目製作夥伴: Boolean(pt.節目製作夥伴),
                            課程製作夥伴: Boolean(pt.課程製作夥伴),
                            Email: String(pt.Email ?? ""),
                            分級: String(pt.分級 ?? ""),
                          });
                          setPartnerEditError(null);
                          setShowEditPartner(true);
                        }}
                        className="cursor-pointer transition hover:bg-amber-50/80"
                      >
                        <td
                          className="w-10 px-2 py-3.5"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedPartnerId((prev) => (prev === pid ? null : pid));
                          }}
                        >
                          <button
                            type="button"
                            className="inline-flex h-7 w-7 items-center justify-center rounded text-stone-500 transition hover:bg-stone-100 hover:text-amber-800"
                            aria-label={expanded ? "收起" : "展開"}
                          >
                            <svg
                              className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                        </td>
                        {partnerListCols.map((k) => {
                          const val = (pt as unknown as Record<string, unknown>)[k];
                          if (
                            k === "是否有經營 私域群" ||
                            k === "廣告經銷夥伴" ||
                            k === "節目製作夥伴" ||
                            k === "課程製作夥伴"
                          ) {
                            const checked = Boolean(val);
                            return (
                              <td key={k} className="px-4 py-3.5 text-center text-sm">
                                {checked ? <span className="text-amber-800">✓</span> : <span className="text-stone-500">—</span>}
                              </td>
                            );
                          }
                          if (k === "社群網站") {
                            return (
                              <td key={k} className="px-4 py-3.5 text-sm" onClick={(e) => e.stopPropagation()}>
                                <SocialLinkIcons value={val as string} />
                              </td>
                            );
                          }
                          const str = String(val ?? "—");
                          return (
                            <td
                              key={k}
                              className={`px-4 py-3.5 text-sm font-medium ${k === "PartnerID" || k === "合作夥伴名稱" ? "whitespace-nowrap text-stone-900" : "text-stone-600"} ${(k === "Email" || k === "頻道｜節目名稱") ? "max-w-[220px] truncate" : ""}`}
                              title={k === "Email" || k === "頻道｜節目名稱" ? str : undefined}
                            >
                              {str}
                            </td>
                          );
                        })}
                      </tr>,
                      expanded && (
                        <tr key={`${pt.PartnerID ?? i}-detail`} className="bg-white/90">
                          <td
                            colSpan={(partnerListCols.length || 6) + 1}
                            className="px-6 py-4 text-sm"
                          >
                            <div className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-3 lg:grid-cols-4">
                              {TABLE_COLUMNS.partners.map((c) => {
                                const val = (pt as unknown as Record<string, unknown>)[c.key];
                                const display =
                                  c.key === "是否有經營 私域群" || c.key === "廣告經銷夥伴" || c.key === "節目製作夥伴" || c.key === "課程製作夥伴"
                                    ? Boolean(val)
                                      ? "✓"
                                      : "—"
                                    : c.key === "社群網站"
                                    ? null
                                    : String(val ?? "—");
                                if (display === null && c.key === "社群網站") {
                                  return (
                                    <div key={c.key} className="md:col-span-2">
                                      <span className="text-xs font-medium text-stone-500">{c.label}：</span>
                                      <span className="ml-1">
                                        <SocialLinkIcons value={val as string} />
                                      </span>
                                    </div>
                                  );
                                }
                                return (
                                  <div key={c.key}>
                                    <span className="text-xs font-medium text-stone-500">{c.label}：</span>
                                    <span className="ml-1 text-stone-600">{display}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </td>
                        </tr>
                      ),
                    ].filter(Boolean);
                  })
                )}
              </tbody>
            </table>
          </div>
          {searchedPartners.length > visiblePartnersRows.length && (
            <p className="mt-2 text-right text-xs text-stone-500">載入中 {visiblePartnersRows.length} / {searchedPartners.length}</p>
          )}
          </>
          )}

          {/* 待審核 */}
          {partnersTab === "pending" && (
            <div className="max-h-[60vh] overflow-y-auto rounded-xl border border-stone-200/90">
              {partnersPendingLoading ? (
                <p className="px-4 py-8 text-center text-stone-500">載入中…</p>
              ) : partnersPending.length === 0 && partnerChangeRequests.length === 0 ? (
                <p className="px-4 py-8 text-center text-stone-500">目前沒有待審核或已駁回的申請</p>
              ) : (
                <>
                {partnerChangeRequests.length > 0 && (
                  <div className="mb-6">
                    <h3 className="mb-2 px-2 text-sm font-bold text-amber-700">已上架 KOL 變更申請（主列表仍為舊資料，核准後才更新）</h3>
                    <table className="min-w-full divide-y divide-stone-200 rounded-xl border border-amber-200">
                      <thead className="bg-amber-50/95">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-semibold text-amber-700">類型</th>
                          <th className="px-4 py-2 text-left text-xs font-semibold text-amber-700">PartnerID</th>
                          <th className="px-4 py-2 text-left text-xs font-semibold text-amber-700">狀態</th>
                          <th className="px-4 py-2 text-left text-xs font-semibold text-amber-700">駁回理由</th>
                          <th className="px-4 py-2 text-left text-xs font-semibold text-amber-700">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-200">
                        {partnerChangeRequests.map((cr) => (
                          <tr key={cr.id} className="bg-amber-950/20">
                            <td className="px-4 py-2 text-xs font-semibold text-amber-800">變更審核</td>
                            <td className="px-4 py-2 text-sm text-stone-900">{cr.PartnerID}</td>
                            <td className="px-4 py-2 text-sm">
                              <span className={cr.審核狀態 === PARTNER_STATUS.REJECTED ? "text-red-400" : "text-amber-800"}>
                                {cr.審核狀態 === PARTNER_STATUS.REJECTED ? "審核未通過" : cr.審核狀態}
                              </span>
                            </td>
                            <td className="max-w-xs truncate px-4 py-2 text-xs text-stone-500" title={cr.駁回理由}>
                              {cr.駁回理由 ?? "—"}
                            </td>
                            <td className="px-4 py-2">
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  className="rounded-lg border border-cyan-500/50 bg-cyan-500/10 px-2 py-1 text-xs font-bold text-cyan-300 hover:bg-cyan-500/20"
                                  onClick={() => setShowChangeRequestDiff(cr)}
                                >
                                  查看差異
                                </button>
                                {canEditVisibility && cr.審核狀態 === PARTNER_STATUS.PENDING && (
                                  <>
                                    <button
                                      type="button"
                                      className="rounded-lg bg-emerald-600 px-2 py-1 text-xs font-bold text-stone-900 hover:bg-emerald-500"
                                      onClick={async () => {
                                        const res = await fetch("/api/partners/change-requests", {
                                          method: "PATCH",
                                          headers: { "Content-Type": "application/json" },
                                          body: JSON.stringify({ id: cr.id, action: "approve" }),
                                        });
                                        const d = (await safeResJson(res)) as { ok?: boolean; partner?: PartnerRow; error?: string };
                                        if (res.ok && d.ok && d.partner) {
                                          setPartnerChangeRequests((prev) => prev.filter((r) => r.id !== cr.id));
                                          setPartners((prev) => {
                                            const pid = d.partner!.PartnerID;
                                            return prev.some((p) => p.PartnerID === pid)
                                              ? prev.map((p) => (p.PartnerID === pid ? d.partner! : p))
                                              : prev;
                                          });
                                        } else window.alert(d.error ?? "核准失敗");
                                      }}
                                    >
                                      核准套用
                                    </button>
                                    <button
                                      type="button"
                                      className="rounded-lg bg-red-600/80 px-2 py-1 text-xs font-bold text-stone-900 hover:bg-red-500"
                                      onClick={() => {
                                        const reason = window.prompt("駁回理由（可留空）", "");
                                        if (reason === null) return;
                                        fetch("/api/partners/change-requests", {
                                          method: "PATCH",
                                          headers: { "Content-Type": "application/json" },
                                          body: JSON.stringify({
                                            id: cr.id,
                                            action: "reject",
                                            駁回理由: reason.trim() || null,
                                          }),
                                        })
                                          .then((r) => safeResJson(r))
                                          .then((d) => {
                                            const x = d as { ok?: boolean; error?: string };
                                            if (x.ok) fetchPartnersPending();
                                            else window.alert(x.error ?? "駁回失敗");
                                          });
                                      }}
                                    >
                                      駁回
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {partnersPending.length > 0 && (
                <table className="min-w-full divide-y divide-stone-200">
                  <thead className="sticky top-0 z-10 bg-amber-100/90">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-amber-700">PartnerID</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-amber-700">合作夥伴名稱</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-amber-700">經紀人</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-amber-700">狀態</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-amber-700">駁回理由</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-amber-700">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-200">
                    {partnersPending.map((pt) => (
                      <tr key={pt.PartnerID} className="bg-amber-50/40">
                        <td className="px-4 py-3 text-sm text-stone-600">{pt.PartnerID}</td>
                        <td className="px-4 py-3 text-sm text-stone-900">{pt.合作夥伴名稱 ?? "—"}</td>
                        <td className="px-4 py-3 text-sm text-stone-600">{pt.經紀人 ?? "—"}</td>
                        <td className="px-4 py-3 text-sm">
                          <span
                            className={
                              pt.審核狀態 === PARTNER_STATUS.REJECTED
                                ? "text-red-400"
                                : "text-amber-800"
                            }
                          >
                            {pt.審核狀態 ?? PARTNER_STATUS.PENDING}
                          </span>
                        </td>
                        <td className="max-w-xs truncate px-4 py-3 text-xs text-stone-500" title={pt.駁回理由}>
                          {pt.駁回理由 ?? "—"}
                        </td>
                        <td className="px-4 py-3">
                          {canEditVisibility ? (
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                className="rounded-lg bg-emerald-600 px-2 py-1 text-xs font-bold text-stone-900 hover:bg-emerald-500"
                                onClick={async () => {
                                  const res = await fetch("/api/partners", {
                                    method: "PATCH",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                      PartnerID: pt.PartnerID,
                                      審核狀態: PARTNER_STATUS.APPROVED,
                                      駁回理由: null,
                                      待審核送出者: null,
                                    }),
                                  });
                                  const data = (await safeResJson(res)) as { ok?: boolean; partner?: PartnerRow };
                                  if (res.ok && data.ok && data.partner) {
                                    setPartnersPending((prev) => prev.filter((p) => p.PartnerID !== pt.PartnerID));
                                    setPartners((prev) => [data.partner!, ...prev]);
                                  } else {
                                    window.alert((data as { error?: string }).error ?? "核准失敗");
                                  }
                                }}
                              >
                                核准
                              </button>
                              <button
                                type="button"
                                className="rounded-lg bg-red-600/80 px-2 py-1 text-xs font-bold text-stone-900 hover:bg-red-500"
                                onClick={() => {
                                  const reason = window.prompt("駁回理由（可留空）", "");
                                  if (reason === null) return;
                                  fetch("/api/partners", {
                                    method: "PATCH",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                      PartnerID: pt.PartnerID,
                                      審核狀態: PARTNER_STATUS.REJECTED,
                                      駁回理由: reason.trim() || null,
                                    }),
                                  })
                                    .then((r) => safeResJson(r))
                                    .then((data) => {
                                      const d = data as { ok?: boolean; partner?: PartnerRow; error?: string };
                                      if (d.ok && d.partner) {
                                        setPartnersPending((prev) =>
                                          prev.map((p) => (p.PartnerID === pt.PartnerID ? d.partner! : p))
                                        );
                                      } else window.alert(d.error ?? "駁回失敗");
                                    });
                                }}
                              >
                                駁回
                              </button>
                              <button
                                type="button"
                                className="rounded-lg border border-stone-300 px-2 py-1 text-xs text-stone-600 hover:bg-stone-100"
                                onClick={() => {
                                  setEditingPartnerSource(pt);
                                  setEditPartnerForm({
                                    PartnerID: String(pt.PartnerID ?? ""),
                                    類別一: String(pt.類別一 ?? ""),
                                    類別二: String(pt.類別二 ?? ""),
                                    類別三: String(pt.類別三 ?? ""),
                                    合作夥伴名稱: String(pt.合作夥伴名稱 ?? ""),
                                    社群網站: String(pt.社群網站 ?? ""),
                                    粉絲數: String(pt.粉絲數 ?? ""),
                                    "頻道｜節目名稱": String(pt["頻道｜節目名稱"] ?? ""),
                                    "是否有經營 私域群": Boolean(pt["是否有經營 私域群"]),
                                    資料夾: String(pt.資料夾 ?? ""),
                                    經紀人: String(pt.經紀人 ?? ""),
                                    KOL開發者: String(pt.KOL開發者 ?? ""),
                                    主管: String(pt.主管 ?? ""),
                                    合約開始日期: String(pt.合約開始日期 ?? ""),
                                    廣告經銷夥伴: Boolean(pt.廣告經銷夥伴),
                                    節目製作夥伴: Boolean(pt.節目製作夥伴),
                                    課程製作夥伴: Boolean(pt.課程製作夥伴),
                                    Email: String(pt.Email ?? ""),
                                    分級: String(pt.分級 ?? ""),
                                  });
                                  setPartnerEditError(null);
                                  setShowEditPartner(true);
                                }}
                              >
                                編輯
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="rounded-lg border border-stone-300 px-2 py-1 text-xs text-stone-600 hover:bg-stone-100"
                              onClick={() => {
                                setEditingPartnerSource(pt);
                                setEditPartnerForm({
                                  PartnerID: String(pt.PartnerID ?? ""),
                                  類別一: String(pt.類別一 ?? ""),
                                  類別二: String(pt.類別二 ?? ""),
                                  類別三: String(pt.類別三 ?? ""),
                                  合作夥伴名稱: String(pt.合作夥伴名稱 ?? ""),
                                  社群網站: String(pt.社群網站 ?? ""),
                                  粉絲數: String(pt.粉絲數 ?? ""),
                                  "頻道｜節目名稱": String(pt["頻道｜節目名稱"] ?? ""),
                                  "是否有經營 私域群": Boolean(pt["是否有經營 私域群"]),
                                  資料夾: String(pt.資料夾 ?? ""),
                                  經紀人: String(pt.經紀人 ?? ""),
                                  KOL開發者: String(pt.KOL開發者 ?? ""),
                                  主管: String(pt.主管 ?? ""),
                                  合約開始日期: String(pt.合約開始日期 ?? ""),
                                  廣告經銷夥伴: Boolean(pt.廣告經銷夥伴),
                                  節目製作夥伴: Boolean(pt.節目製作夥伴),
                                  課程製作夥伴: Boolean(pt.課程製作夥伴),
                                  Email: String(pt.Email ?? ""),
                                  分級: String(pt.分級 ?? ""),
                                });
                                setPartnerEditError(null);
                                setShowEditPartner(true);
                              }}
                            >
                              查看／修改
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                )}
                </>
              )}
            </div>
          )}
        </section>
        )}

        {/* 任務 */}
        {activeSection === "tasks" && (
        <section className="rounded-2xl border border-stone-200/90 bg-white/90 p-4 shadow-xl ring-1 ring-amber-100/60 sm:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-bold tracking-tight text-stone-900">任務</h2>
            <input
              type="text"
              value={tasksSearch}
              onChange={(e) => setTasksSearch(e.target.value)}
              placeholder="搜尋專案名稱、任務、負責人…"
              className="w-full min-w-0 max-w-60 rounded-full border border-stone-200 bg-stone-50 px-3.5 py-1.5 text-xs text-stone-800 placeholder:text-stone-500 focus:border-amber-500/60 focus:outline-none"
            />
          </div>
          {/* 小螢幕：任務卡片 */}
          <div className="space-y-3 md:hidden">
            {filteredTasks.length === 0 ? (
              <p className="rounded-xl border border-stone-200/90 px-4 py-8 text-center text-stone-500">尚無任務資料（請在大總表展開專案後新增任務）</p>
            ) : searchedTasks.length === 0 ? (
              <p className="rounded-xl border border-stone-200/90 px-4 py-8 text-center text-stone-500">沒有符合搜尋結果</p>
            ) : (
              visibleTasksRows.map((t, i) => (
                <div
                  key={t.任務ID ?? i}
                  className="cursor-pointer rounded-xl border border-stone-200/90 bg-amber-50/50 p-4 transition hover:bg-amber-50/80"
                  onClick={() => setSelectedTask(t)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-stone-900">{t.任務 ?? "—"}</p>
                      <p className="mt-0.5 text-xs text-stone-500">{t.專案名稱 ?? "—"}</p>
                    </div>
                    <span className={`shrink-0 rounded px-2 py-0.5 text-xs ${t.任務完成 ? "bg-amber-100 text-amber-800" : "bg-stone-200 text-stone-500"}`}>{t.任務完成 ? "已完成" : "進行中"}</span>
                  </div>
                  <p className="mt-2 text-xs text-stone-500">負責人：{t.任務負責人 ?? "—"}</p>
                </div>
              ))
            )}
          </div>
          {/* 大螢幕：表格 */}
          <div className="hidden overflow-x-auto rounded-xl border border-stone-200/90 md:block">
            <table className="min-w-full divide-y divide-stone-200">
              <thead className="bg-stone-100">
                <tr>
                  {tasksVisibleCols.map((k) => (
                    <th key={k} className={k === "專案ID" ? "px-4 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-amber-800" : k === "任務完成" ? "px-4 py-3.5 text-center text-xs font-bold uppercase tracking-wider text-stone-600" : "px-4 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-stone-600"}>
                      {tableColumnLabels.tasks?.[k] ?? k}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200 bg-amber-50/40">
                {filteredTasks.length === 0 ? (
                  <tr>
                    <td colSpan={tasksVisibleCols.length || 6} className="px-4 py-8 text-center text-base font-medium text-stone-500">
                      尚無任務資料（請在大總表展開專案後新增任務）
                    </td>
                  </tr>
                ) : searchedTasks.length === 0 ? (
                  <tr>
                    <td colSpan={tasksVisibleCols.length || 6} className="px-4 py-8 text-center text-base font-medium text-stone-500">
                      沒有符合搜尋結果
                    </td>
                  </tr>
                ) : (
                  visibleTasksRows.map((t, i) => (
                    <tr
                      key={t.任務ID ?? i}
                      className="cursor-pointer transition hover:bg-amber-50/80"
                      onClick={() => setSelectedTask(t)}
                    >
                      {tasksVisibleCols.map((k) => {
                        if (k === "專案ID") {
                          return (
                            <td key={k} className="whitespace-nowrap px-4 py-3.5 text-xs font-normal text-stone-500" title={t.專案ID}>{t.專案ID ? "SDH-…" : "—"}</td>
                          );
                        }
                        if (k === "任務負責人") {
                          return (
                            <td key={k} className="whitespace-nowrap px-4 py-3.5 text-sm font-medium text-stone-600">
                              <span className="inline-flex items-center gap-1.5">
                                {t.任務負責人 ?? "—"}
                                {t.任務負責人 && t.任務ID && (
                                  <button
                                    type="button"
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      if (!t.任務ID) return;
                                      setRemindingTaskId(t.任務ID);
                                      try {
                                        const res = await fetch("/api/tasks/remind", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ 任務ID: t.任務ID }) });
                                        const data = (await safeResJson(res)) as { ok?: boolean };
                                        if (res.ok && data.ok) { /* 可選：toast */ }
                                      } finally { setRemindingTaskId(null); }
                                    }}
                                    disabled={remindingTaskId === t.任務ID}
                                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-stone-300 bg-stone-50 text-stone-500 transition hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800 disabled:opacity-50"
                                    title="發信提醒"
                                  >
                                    {remindingTaskId === t.任務ID ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" /> : <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>}
                                  </button>
                                )}
                              </span>
                            </td>
                          );
                        }
                        if (k === "任務完成") {
                          return (
                            <td key={k} className="px-4 py-3.5 text-center">
                              <button
                                type="button"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (!t.任務ID) return;
                                  const next = !t.任務完成;
                                  try {
                                    const res = await fetch("/api/tasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ 任務ID: t.任務ID, 任務完成: next }) });
                                    const data = (await safeResJson(res)) as { ok?: boolean; task?: TaskRow };
                                    if (res.ok && data.ok) setTasks((prev) => prev.map((x) => (x.任務ID === t.任務ID ? data.task! : x)));
                                  } catch { /* 忽略 */ }
                                }}
                                className="inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-2 transition hover:border-amber-400/70 hover:bg-amber-50"
                                style={{ backgroundColor: t.任務完成 ? "rgba(245,158,11,0.25)" : "transparent", borderColor: t.任務完成 ? "rgba(245,158,11,0.5)" : "rgba(255,255,255,0.2)" }}
                                title={t.任務完成 ? "點擊取消完成" : "點擊標記完成"}
                              >
                                {t.任務完成 ? <span className="text-amber-800">✓</span> : null}
                              </button>
                            </td>
                          );
                        }
                        const val = (t as unknown as Record<string, unknown>)[k];
                        const str = String(val ?? "—");
                        return (
                          <td key={k} className={k === "任務" ? "max-w-[240px] truncate px-4 py-3.5 text-sm font-medium text-stone-900" : k === "專案名稱" ? "max-w-[180px] truncate px-4 py-3.5 text-sm font-medium text-stone-600" : "whitespace-nowrap px-4 py-3.5 text-sm font-medium text-stone-600"} title={k === "專案名稱" || k === "任務" ? str : undefined}>
                            {str}
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {searchedTasks.length > visibleTasksRows.length && (
            <p className="mt-2 text-right text-xs text-stone-500">載入中 {visibleTasksRows.length} / {searchedTasks.length}</p>
          )}
        </section>
        )}

        {/* 分潤表 */}
        {activeSection === "payout" && (
        <section className="rounded-2xl border border-stone-200/90 bg-white/90 p-4 shadow-xl ring-1 ring-amber-100/60 sm:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-bold tracking-tight text-stone-900">分潤表</h2>
            <input
              type="text"
              value={payoutSearch}
              onChange={(e) => setPayoutSearch(e.target.value)}
              placeholder="搜尋專案ID、類型、領取人…"
              className="w-full min-w-0 max-w-60 rounded-full border border-stone-200 bg-stone-50 px-3.5 py-1.5 text-xs text-stone-800 placeholder:text-stone-500 focus:border-amber-500/60 focus:outline-none"
            />
          </div>
          {filteredPayout.length === 0 ? (
            <p className="rounded-xl border border-stone-200/90 px-4 py-8 text-center text-stone-500">尚無分潤表資料</p>
          ) : (
            <>
              {/* 小螢幕：卡片式收納顯示（分潤金額為主、次要資訊、其他可摺疊） */}
              <div className="space-y-3 md:hidden">
                {searchedPayout.length === 0 ? (
                  <p className="rounded-xl border border-stone-200/90 px-4 py-8 text-center text-stone-500">沒有符合搜尋結果</p>
                ) : (
                  visiblePayoutRows.map((row, i) => {
                    const r = row as unknown as Record<string, unknown>;
                    const cardKey = String(row.id ?? `payout-${i}`);
                    const isExpanded = expandedPayoutCardKey === cardKey;
                    const showAmt = payoutVisibleCols.includes("分潤金額");
                    const showPct = payoutVisibleCols.includes("分潤成數");
                    const showTitle = payoutVisibleCols.includes("專案名稱");
                    const detailKeys = ["專案ID", "專案預計匯款日", "專案實際入帳日期", "分潤匯款日期", "專案營收", "專案總金額未稅", "分潤類型", "領取人"] as const;
                    const hasExpandable = detailKeys.some((k) => payoutVisibleCols.includes(k));
                    return (
                      <div key={cardKey} className="rounded-xl border border-stone-200/90 bg-amber-50/50 p-4">
                        {/* 主要：分潤金額（與 ③ 可見欄位一致，所有人同一套 UI） */}
                        {showAmt && (
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-xs font-semibold uppercase tracking-wider text-amber-800">分潤金額</span>
                            <span className="text-2xl font-bold tabular-nums text-amber-800">{formatAmount(String(r.分潤金額 ?? ""))}</span>
                          </div>
                        )}
                        {/* 次要：分潤成數、專案名稱 */}
                        {(showPct || showTitle) && (
                          <div className={`space-y-1 border-b border-stone-200/90 pb-3 ${showAmt ? "mt-3" : ""}`}>
                            {showPct && (
                              <p className="text-sm font-medium text-stone-600">
                                <span className="text-stone-500">分潤成數</span> <span className="text-amber-800">{String(r.分潤成數 ?? "—")}</span>
                              </p>
                            )}
                            {showTitle && (
                              <p className="truncate text-sm text-stone-600" title={String(r.專案名稱 ?? "")}>
                                <span className="text-stone-500">專案</span> {String(r.專案名稱 ?? "—")}
                              </p>
                            )}
                          </div>
                        )}
                        {/* 可摺疊：其餘可見欄位 */}
                        {hasExpandable && (
                          <div className="mt-2">
                            <button
                              type="button"
                              onClick={() => setExpandedPayoutCardKey((k) => (k === cardKey ? null : cardKey))}
                              className="flex w-full items-center justify-between rounded-lg py-1.5 text-xs text-stone-500 transition hover:bg-amber-50/80 hover:text-stone-500"
                            >
                              <span>{isExpanded ? "收起詳情" : "展開詳情"}</span>
                              <span className="text-stone-500">{isExpanded ? "▲" : "▼"}</span>
                            </button>
                            {isExpanded && (
                              <div className="mt-2 space-y-1 rounded-lg bg-white/90 px-3 py-2 text-xs text-stone-500">
                                {payoutVisibleCols.includes("專案ID") && (
                                  <p><span className="text-stone-500">專案ID</span> {String(r.專案ID ?? "—")}</p>
                                )}
                                {payoutVisibleCols.includes("專案營收") && (
                                  <p><span className="text-stone-500">專案營收</span> {formatAmount(String(r.專案營收 ?? ""))}</p>
                                )}
                                {payoutVisibleCols.includes("專案總金額未稅") && (
                                  <p><span className="text-stone-500">專案總金額未稅</span> {formatAmount(String(r.專案總金額未稅 ?? ""))}</p>
                                )}
                                {payoutVisibleCols.includes("專案預計匯款日") && (
                                  <p><span className="text-stone-500">專案預計匯款日</span> {String(r.專案預計匯款日 ?? "—")}</p>
                                )}
                                {payoutVisibleCols.includes("專案實際入帳日期") && (
                                  <p><span className="text-stone-500">專案實際入帳日期</span> {String(r.專案實際入帳日期 ?? "—")}</p>
                                )}
                                {payoutVisibleCols.includes("分潤匯款日期") && (
                                  <p><span className="text-stone-500">分潤匯款日期</span> {String(r.分潤匯款日期 ?? "—")}</p>
                                )}
                                {payoutVisibleCols.includes("分潤類型") && (
                                  <p><span className="text-stone-500">分潤類型</span> {String(r.分潤類型 ?? "—")}</p>
                                )}
                                {payoutVisibleCols.includes("領取人") && (
                                  <p><span className="text-stone-500">領取人</span> {String(r.領取人 ?? "—")}</p>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
              {/* 大螢幕：表格 */}
              <div className="hidden overflow-x-auto rounded-xl border border-stone-200/90 md:block">
                <table className="min-w-full divide-y divide-stone-200">
                  <thead className="bg-stone-100">
                    <tr>
                      {payoutColsForDisplay.map((k) => (
                        <th
                          key={k}
                          className={
                            k === "分潤金額"
                              ? "px-4 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-amber-800"
                              : k === "專案ID"
                                ? "px-4 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-amber-800/80"
                                : "px-4 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-stone-600"
                          }
                        >
                          {tableColumnLabels.payout?.[k] ?? k}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-200 bg-amber-50/40">
                    {searchedPayout.length === 0 ? (
                      <tr>
                        <td colSpan={payoutColsForDisplay.length || 7} className="px-4 py-8 text-center text-base font-medium text-stone-500">
                          沒有符合搜尋結果
                        </td>
                      </tr>
                    ) : (
                      visiblePayoutRows.map((row, i) => (
                        <tr key={row.id ?? i} className="hover:bg-amber-50/80">
                          {payoutColsForDisplay.map((k) => {
                            const val = (row as unknown as Record<string, unknown>)[k];
                            const str = k === "分潤金額" ? formatAmount(String(val ?? "")) : String(val ?? "—");
                            return (
                              <td
                                key={k}
                                className={`whitespace-nowrap px-4 py-3.5 text-sm ${
                                  k === "分潤金額" ? "font-bold tabular-nums text-amber-800" : k === "專案ID" ? "font-medium text-stone-500" : "font-medium text-stone-600"
                                }`}
                              >
                                {str}
                              </td>
                            );
                          })}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {searchedPayout.length > visiblePayoutRows.length && (
                <p className="mt-2 text-right text-xs text-stone-500">載入中 {visiblePayoutRows.length} / {searchedPayout.length}</p>
              )}
            </>
          )}
        </section>
        )}

        {/* 財務（DB：財務） */}
        {activeSection === "finance" && (
        <section className="rounded-2xl border border-stone-200/90 bg-white/90 p-4 shadow-xl ring-1 ring-amber-100/60 sm:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-bold tracking-tight text-stone-900">財務</h2>
            <input
              type="text"
              value={financeSearch}
              onChange={(e) => setFinanceSearch(e.target.value)}
              placeholder="搜尋專案ID、利潤、狀態…"
              className="w-full min-w-0 max-w-60 rounded-full border border-stone-200 bg-stone-50 px-3.5 py-1.5 text-xs text-stone-800 placeholder:text-stone-500 focus:border-amber-500/60 focus:outline-none"
            />
          </div>
          <div className="overflow-x-auto rounded-xl border border-stone-200/90">
            {finance.length === 0 ? (
              <p className="px-4 py-8 text-center text-stone-500">尚無財務資料</p>
            ) : (
              <table className="min-w-full divide-y divide-stone-200">
                <thead className="bg-stone-100">
                  <tr>
                    {financeVisibleCols.map((k) => (
                      <th key={k} className={k === "專案ID" ? "px-4 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-amber-800" : "px-4 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-stone-600"}>
                        {tableColumnLabels.finance?.[k] ?? k}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200 bg-amber-50/40">
                  {searchedFinance.length === 0 ? (
                    <tr>
                      <td colSpan={financeVisibleCols.length || 9} className="px-4 py-8 text-center text-base font-medium text-stone-500">
                        沒有符合搜尋結果
                      </td>
                    </tr>
                  ) : (
                    visibleFinanceRows.map((row, i) => (
                      <tr key={i} className="hover:bg-amber-50/80">
                        {financeVisibleCols.map((k) => {
                          const v = (row as unknown as Record<string, unknown>)[k];
                          return <td key={k} className="whitespace-nowrap px-4 py-3.5 text-sm text-stone-600">{String(v ?? "—")}</td>;
                        })}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>
          {searchedFinance.length > visibleFinanceRows.length && (
            <p className="mt-2 text-right text-xs text-stone-500">載入中 {visibleFinanceRows.length} / {searchedFinance.length}</p>
          )}
        </section>
        )}

        {/* 發票（DB：發票） */}
        {activeSection === "invoices" && (
        <section className="rounded-2xl border border-stone-200/90 bg-white/90 p-4 shadow-xl ring-1 ring-amber-100/60 sm:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-bold tracking-tight text-stone-900">發票</h2>
            <input
              type="text"
              value={invoicesSearch}
              onChange={(e) => setInvoicesSearch(e.target.value)}
              placeholder="搜尋專案ID、發票號碼、廠商…"
              className="w-full min-w-0 max-w-60 rounded-full border border-stone-200 bg-stone-50 px-3.5 py-1.5 text-xs text-stone-800 placeholder:text-stone-500 focus:border-amber-500/60 focus:outline-none"
            />
          </div>
          <div className="overflow-x-auto rounded-xl border border-stone-200/90">
            {invoices.length === 0 ? (
              <p className="px-4 py-8 text-center text-stone-500">尚無發票資料</p>
            ) : (
              <table className="min-w-full divide-y divide-stone-200">
                <thead className="bg-stone-100">
                  <tr>
                    {invoicesVisibleCols.map((k) => (
                      <th key={k} className={k === "專案ID" ? "px-4 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-amber-800" : "px-4 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-stone-600"}>
                        {tableColumnLabels.invoices?.[k] ?? k}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200 bg-amber-50/40">
                  {searchedInvoices.length === 0 ? (
                    <tr>
                      <td colSpan={invoicesVisibleCols.length || 10} className="px-4 py-8 text-center text-base font-medium text-stone-500">
                        沒有符合搜尋結果
                      </td>
                    </tr>
                  ) : (
                    visibleInvoicesRows.map((inv, i) => (
                      <tr key={i} className="hover:bg-amber-50/80">
                        {invoicesVisibleCols.map((k) => {
                          const v = (inv as unknown as Record<string, unknown>)[k];
                          return (
                            <td key={k} className={`whitespace-nowrap px-4 py-3.5 text-sm ${k === "專案ID" ? "font-medium text-stone-900" : "text-stone-600"}`}>
                              {String(v ?? "—")}
                            </td>
                          );
                        })}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>
          {searchedInvoices.length > visibleInvoicesRows.length && (
            <p className="mt-2 text-right text-xs text-stone-500">載入中 {visibleInvoicesRows.length} / {searchedInvoices.length}</p>
          )}
        </section>
        )}
          </div>
        </div>
      )}

      {/* 大總表 新增專案 Modal */}
      {showCreateMaster && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-stone-900/30 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-stone-200/90 bg-white shadow-2xl ring-1 ring-stone-200/80">
            <form
              className="flex max-h-[90vh] flex-col"
              onSubmit={async (e) => {
                e.preventDefault();
                setCreateError(null);
                if (!createForm.專案ID.trim()) {
                  setCreateError("請填寫專案ID");
                  return;
                }
                setCreating(true);
                try {
                  const res = await fetch("/api/master", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    cache: "no-store",
                    body: JSON.stringify({
                    ...createForm,
                    專案營收: calc專案營收(createForm.專案總金額未稅, createForm.專案成本, createForm.KOL費用未稅),
                  }),
                  });
                  const data = (await safeResJson(res)) as { ok?: boolean; error?: string; master?: MasterRow };
                  if (!res.ok || !data.ok || !data.master) {
                    setCreateError(data.error ?? "新增失敗");
                    setCreating(false);
                    return;
                  }
                  setMasterList((prev) => [data.master!, ...prev]);
                  await refreshDashboardData(["master", "payout", "finance"]);
                  setCreating(false);
                  setShowCreateMaster(false);
                } catch (err: unknown) {
                  setCreateError(err instanceof Error ? err.message : "新增失敗");
                  setCreating(false);
                }
              }}
            >
              <header className="flex items-center justify-between border-b border-stone-200/90 bg-stone-100/90 px-6 py-4">
                <h2 className="text-xl font-bold tracking-tight text-stone-900">新增大總表專案</h2>
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateMaster(false);
                    setCreating(false);
                    setCreateError(null);
                  }}
                  className="rounded-xl border border-stone-300 bg-stone-50 px-4 py-2 text-sm font-semibold text-stone-600 transition hover:bg-amber-50 hover:text-amber-800"
                >
                  關閉
                </button>
              </header>
              <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
                {createError && <p className="rounded-lg bg-amber-100/90 px-3 py-2 text-sm font-medium text-amber-800">{createError}</p>}

                <section>
                  <h3 className="mb-3 text-base font-bold text-amber-800">基本資料</h3>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-stone-500">專案ID</label>
                      <div className="rounded-xl border border-stone-300 bg-stone-50 px-3 py-2.5 text-sm font-semibold text-stone-900">
                        {createForm.專案ID}
                      </div>
                      <p className="mt-1 text-xs font-medium text-stone-500">自動產生（SDH-日期時間-隨機碼）</p>
                    </div>
                    <InputField label="專案名稱" value={createForm.專案名稱} onChange={(v) => setCreateForm((f) => ({ ...f, 專案名稱: v }))} />
                    <SelectField label="專案類型" value={createForm.專案類型} onChange={(v) => setCreateForm((f) => ({ ...f, 專案類型: v }))} options={projectTypesOptions} />
                    <InputField label="專案狀態" value={createForm.專案狀態} onChange={(v) => setCreateForm((f) => ({ ...f, 專案狀態: v }))} />
                    <DateField label="開案日期" value={createForm.開案日期} onChange={(v) => setCreateForm((f) => ({ ...f, 開案日期: v }))} />
                    <DateField label="狀態確認日期" value={createForm.狀態確認日期} onChange={(v) => setCreateForm((f) => ({ ...f, 狀態確認日期: v }))} />
                    <InputField label="專案資料夾" value={createForm.專案資料夾} onChange={(v) => setCreateForm((f) => ({ ...f, 專案資料夾: v }))} className="col-span-2" />
                  </div>
                </section>

                <section>
                  <h3 className="mb-3 text-base font-bold text-amber-800">金額與成本</h3>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                    <NumberField
                      label="專案總金額未稅"
                      value={createForm.專案總金額未稅}
                      onChange={(v) =>
                        setCreateForm((f) => ({
                          ...f,
                          專案總金額未稅: v,
                          專案營收: calc專案營收(v, f.專案成本, f.KOL費用未稅),
                        }))
                      }
                    />
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-stone-500">專案營收</label>
                      <div className="w-full rounded-xl border border-stone-300 bg-stone-50 px-3 py-2.5 text-sm font-medium text-stone-600 tabular-nums">
                        {formatAmount(createForm.專案營收)}
                      </div>
                      <p className="mt-1 text-xs text-stone-500">自動計算：專案總金額未稅 − 專案成本 − KOL費用未稅</p>
                    </div>
                    <NumberField
                      label="專案成本"
                      value={createForm.專案成本}
                      onChange={(v) =>
                        setCreateForm((f) => ({
                          ...f,
                          專案成本: v,
                          專案營收: calc專案營收(f.專案總金額未稅, v, f.KOL費用未稅),
                        }))
                      }
                    />
                    <NumberField
                      label="KOL費用未稅"
                      value={createForm.KOL費用未稅}
                      onChange={(v) =>
                        setCreateForm((f) => ({
                          ...f,
                          KOL費用未稅: v,
                          專案營收: calc專案營收(f.專案總金額未稅, f.專案成本, v),
                        }))
                      }
                    />
                    <InputField label="專案費用類型" value={createForm.專案費用類型} onChange={(v) => setCreateForm((f) => ({ ...f, 專案費用類型: v }))} className="col-span-2" />
                  </div>
                </section>

                <section>
                  <h3 className="mb-3 text-base font-bold text-amber-800">人員與分潤設定</h3>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                    <InputField label="KOL名稱" value={createForm.KOL名稱} onChange={(v) => setCreateForm((f) => ({ ...f, KOL名稱: v }))} />
                    <InputField label="廠商名稱" value={createForm.廠商名稱} onChange={(v) => setCreateForm((f) => ({ ...f, 廠商名稱: v }))} />
                    {isPayoutModeB(createForm.專案類型) ? (
                      <>
                        <SelectField
                          label="專案引薦人"
                          value={createForm.專案引薦人}
                          onChange={(v) => setCreateForm((f) => ({ ...f, 專案引薦人: v }))}
                          options={userNames}
                        />
                        <Field label="專案引薦人分潤成數" value={payoutDefaults.專案引薦人分潤成數} />
                        <Field label="經紀人（由 KOL 帶出）" value={partners.find((p) => p.合作夥伴名稱 === createForm.KOL名稱)?.經紀人 ?? "—"} />
                        <Field label="經紀人分潤成數" value={payoutDefaults.經紀人分潤成數} />
                        <Field label="主管（由 KOL 帶出）" value={partners.find((p) => p.合作夥伴名稱 === createForm.KOL名稱)?.主管 ?? "—"} />
                        <Field label="主管分潤成數" value={payoutDefaults.主管分潤成數} />
                        <Field label="KOL開發者（由 KOL 帶出）" value={partners.find((p) => p.合作夥伴名稱 === createForm.KOL名稱)?.KOL開發者 ?? "—"} />
                        <Field label="KOL開發者分潤成數" value={payoutDefaults.KOL開發者分潤成數} />
                      </>
                    ) : (
                      <>
                        <SelectField label="專案BDPM" value={createForm.專案BDPM} onChange={(v) => setCreateForm((f) => ({ ...f, 專案BDPM: v }))} options={userNames} />
                        <Field label="專案BDPM分潤成數" value={payoutDefaults.專案BDPM分潤成數} />
                        <SelectField
                          label="專案引薦人"
                          value={createForm.專案引薦人}
                          onChange={(v) => setCreateForm((f) => ({ ...f, 專案引薦人: v }))}
                          options={userNames}
                        />
                        <Field label="專案引薦人分潤成數" value={payoutDefaults.專案引薦人分潤成數} />
                        <SelectField
                          label="專案管理員"
                          value={createForm.專案管理員}
                          onChange={(v) => setCreateForm((f) => ({ ...f, 專案管理員: v }))}
                          options={userNames}
                        />
                        <Field label="專案管理員分潤成數" value={payoutDefaults.專案管理員分潤成數} />
                        <SelectField
                          label="執行管理員"
                          value={createForm.執行管理員}
                          onChange={(v) => setCreateForm((f) => ({ ...f, 執行管理員: v }))}
                          options={userNames}
                        />
                        <Field label="執行管理員分潤成數" value={payoutDefaults.執行管理員分潤成數} />
                        <Field label="KOL開發者分潤成數" value={payoutDefaults.KOL開發者分潤成數} />
                      </>
                    )}
                  </div>
                </section>

                <section>
                  <h3 className="mb-3 text-base font-bold text-amber-800">內容與備註</h3>
                  <div className="space-y-4">
                    <TextAreaField
                      label="專案內容"
                      value={createForm.專案內容}
                      onChange={(v) => setCreateForm((f) => ({ ...f, 專案內容: v }))}
                    />
                    <TextAreaField
                      label="備註"
                      value={createForm.備註}
                      onChange={(v) => setCreateForm((f) => ({ ...f, 備註: v }))}
                    />
                  </div>
                </section>
              </div>

              <footer className="flex items-center justify-end gap-3 border-t border-stone-200/90 bg-stone-100/90 px-6 py-4">
                <button
                  type="button"
                  className="rounded-xl border border-stone-300 bg-stone-50 px-4 py-2.5 text-sm font-semibold text-stone-600 transition hover:bg-stone-100"
                  onClick={() => {
                    setShowCreateMaster(false);
                    setCreating(false);
                    setCreateError(null);
                  }}
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-bold text-slate-900 shadow-lg shadow-amber-200/30 transition hover:bg-amber-400 disabled:opacity-60"
                >
                  {creating ? "儲存中..." : "儲存"}
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}

      {/* 使用者可見範圍設定 Modal */}
      {selectedUserForVisibility && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-stone-900/30 backdrop-blur-sm p-4">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-stone-200/90 bg-white shadow-2xl ring-1 ring-stone-200/80">
            <header className="shrink-0 flex items-center justify-between border-b border-stone-200/90 bg-stone-100/90 px-6 py-4">
              <h2 className="text-xl font-bold tracking-tight text-stone-900">
                ③ 設定 {selectedUserForVisibility.name}（{selectedUserForVisibility.email}）可見欄位
              </h2>
              <button
                type="button"
                onClick={() => {
                  setSelectedUserForVisibility(null);
                  setVisibilityError(null);
                }}
                className="rounded-xl border border-stone-300 bg-stone-50 px-4 py-2 text-sm font-semibold text-stone-600 transition hover:bg-amber-50 hover:text-amber-800"
              >
                關閉
              </button>
            </header>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-6 py-5">
              {editUserError && (
                <p className="rounded-lg bg-amber-100/90 px-3 py-2 text-sm font-medium text-amber-800">{editUserError}</p>
              )}
              {visibilityError && (
                <p className="rounded-lg bg-amber-100/90 px-3 py-2 text-sm font-medium text-amber-800">{visibilityError}</p>
              )}

              {/* 基本資料：可修改姓名、角色、部門、scope、密碼 */}
              <div className="rounded-xl border border-stone-200/90 bg-white/90 p-4">
                <h3 className="mb-3 text-sm font-semibold text-amber-800">基本資料</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-xs font-medium text-stone-500">帳號 (Email)</label>
                    <p className="rounded-lg border border-stone-200/90 bg-white/90 px-3 py-2 text-sm text-stone-500">{selectedUserForVisibility.email}</p>
                  </div>
                  <InputField label="姓名" value={editUserForm.name} onChange={(v) => setEditUserForm((f) => ({ ...f, name: v }))} />
                  <SelectField
                    label="角色"
                    value={displayRoles.includes(editUserForm.role) ? editUserForm.role : (displayRoles[0] ?? "")}
                    onChange={(v) => setEditUserForm((f) => ({ ...f, role: v }))}
                    options={[...displayRoles]}
                  />
                  <InputField label="部門" value={editUserForm.dept} onChange={(v) => setEditUserForm((f) => ({ ...f, dept: v }))} />
                  <InputField label="責任範圍 (scope)" value={editUserForm.scope} onChange={(v) => setEditUserForm((f) => ({ ...f, scope: v }))} />
                  <div className="sm:col-span-2">
                    <InputField label="新密碼（不修改請留白）" type="password" value={editUserForm.password} onChange={(v) => setEditUserForm((f) => ({ ...f, password: v }))} />
                  </div>
                </div>
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    disabled={savingUser}
                    onClick={async () => {
                      setEditUserError(null);
                      if (!editUserForm.name.trim()) {
                        setEditUserError("姓名為必填");
                        return;
                      }
                      const role = displayRoles.includes(editUserForm.role) ? editUserForm.role : (displayRoles[0] ?? "");
                      if (!role) {
                        setEditUserError("請選擇角色");
                        return;
                      }
                      setSavingUser(true);
                      try {
                        const res = await fetch("/api/users", {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            email: selectedUserForVisibility.email,
                            name: editUserForm.name.trim(),
                            role,
                            dept: editUserForm.dept.trim() || undefined,
                            scope: editUserForm.scope.trim() || undefined,
                            ...(editUserForm.password.trim() ? { password: editUserForm.password.trim() } : {}),
                          }),
                        });
                        const data = (await safeResJson(res)) as { ok?: boolean; error?: string; user?: User };
                        if (!res.ok || !data.ok) {
                          setEditUserError(data.error ?? "儲存失敗");
                          setSavingUser(false);
                          return;
                        }
                        setUsers((prev) => prev.map((u) => (u.email === selectedUserForVisibility.email ? data.user! : u)));
                        setSelectedUserForVisibility(data.user!);
                        setEditUserForm((f) => ({ ...f, password: "" }));
                        setSavingUser(false);
                      } catch (err) {
                        setEditUserError(err instanceof Error ? err.message : "儲存失敗");
                        setSavingUser(false);
                      }
                    }}
                    className="rounded-lg bg-amber-100/90 px-4 py-2 text-sm font-bold text-amber-800 transition hover:bg-amber-200/60 disabled:opacity-60"
                  >
                    {savingUser ? "儲存中..." : "儲存基本資料"}
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-amber-200/80 bg-stone-50/95 p-4">
                <h3 className="text-sm font-semibold text-amber-800">總覽指標可見性</h3>
                <p className="mt-1 text-xs text-stone-500">
                  未按「還原」時可覆寫 ④ 中該角色的預設；儲存後寫入 user_visibility。還原後改依①角色設定。
                </p>
                <button
                  type="button"
                  onClick={() => setVisibilityOverviewKpis(null)}
                  className="mt-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-semibold text-stone-600 transition hover:bg-stone-100"
                >
                  還原為①角色預設
                </button>
                <div className="mt-3 flex flex-wrap gap-x-3 gap-y-2">
                  {OVERVIEW_KPI_KEYS.map((k) => {
                    const roleK =
                      systemConfig?.overview_kpi_by_role?.[selectedUserForVisibility.role] ??
                      getDefaultOverviewKpisForRole(selectedUserForVisibility.role);
                    const effective = visibilityOverviewKpis ?? roleK;
                    const checked = effective.includes(k);
                    return (
                      <label key={k} className="flex cursor-pointer items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const roleKeys =
                              systemConfig?.overview_kpi_by_role?.[selectedUserForVisibility.role] ??
                              getDefaultOverviewKpisForRole(selectedUserForVisibility.role);
                            const start = visibilityOverviewKpis ?? [...roleKeys];
                            const next = e.target.checked
                              ? Array.from(new Set([...start, k]))
                              : start.filter((x) => x !== k);
                            setVisibilityOverviewKpis(next);
                          }}
                          className="h-3.5 w-3.5 rounded border-stone-300 bg-stone-50 text-amber-500"
                        />
                        <span className="text-xs text-stone-600">{OVERVIEW_KPI_LABELS[k]}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <h3 className="text-sm font-semibold text-amber-800">可見欄位</h3>
              <p className="text-sm text-stone-500">勾選此使用者可看到的 Table 與欄位。未勾選的欄位（如專案分潤、專案成本）將不顯示。未設定時依角色預設顯示。</p>
              <div className="space-y-4">
                {TABLE_KEYS.map((tableKey) => {
                  const cols = TABLE_COLUMNS[tableKey] ?? [];
                  const isTableChecked = visibilityTables.includes(tableKey);
                  const selectedCols = visibilityColumns[tableKey] ?? [];
                  const hasAllCols = selectedCols.includes("*") || (isTableChecked && selectedCols.length === 0);
                  return (
                    <div key={tableKey} className="rounded-xl border border-stone-200/90 bg-white/90 p-4">
                      <label className="mb-3 flex cursor-pointer items-center gap-3">
                        <input
                          type="checkbox"
                          checked={isTableChecked}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setVisibilityTables((prev) =>
                              checked ? [...prev, tableKey] : prev.filter((t) => t !== tableKey)
                            );
                            if (!checked) {
                              setVisibilityColumns((prev) => {
                                const next = { ...prev };
                                delete next[tableKey];
                                return next;
                              });
                            }
                          }}
                          className="h-4 w-4 rounded border-stone-300 bg-stone-50 text-amber-500 focus:ring-amber-500/50"
                        />
                        <span className="font-semibold text-stone-900">{TABLE_LABELS[tableKey] ?? tableKey}</span>
                      </label>
                      {isTableChecked && (
                        <div className="ml-7 mt-3 space-y-2 border-l-2 border-stone-200/90 pl-4">
                          <p className="text-xs font-medium uppercase tracking-wide text-stone-500">可見欄位</p>
                          {cols.map(({ key, label }) => {
                            const colChecked =
                              hasAllCols || selectedCols.includes("*") || selectedCols.includes(key);
                            return (
                              <label key={key} className="flex cursor-pointer items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={colChecked}
                                  onChange={(e) => {
                                    const checked = e.target.checked;
                                    setVisibilityColumns((prev) => {
                                      const list = prev[tableKey] ?? ["*"];
                                      const isAll = list.includes("*");
                                      const current = isAll ? cols.map((c) => c.key) : list;
                                      const newList = checked
                                        ? [...current.filter((c) => c !== key), key]
                                        : current.filter((c) => c !== key);
                                      if (newList.length === cols.length) return { ...prev, [tableKey]: ["*"] };
                                      if (newList.length === 0) return { ...prev, [tableKey]: ["*"] };
                                      return { ...prev, [tableKey]: newList };
                                    });
                                  }}
                                  className="h-3.5 w-3.5 rounded border-stone-300 bg-stone-50 text-amber-500 focus:ring-amber-500/50"
                                />
                                <span className="text-sm text-stone-600">{label}</span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <footer className="shrink-0 flex items-center justify-end gap-3 border-t border-stone-200/90 bg-stone-100/90 px-6 py-4">
              <button
                type="button"
                onClick={() => {
                  setSelectedUserForVisibility(null);
                  setVisibilityError(null);
                }}
                className="rounded-xl border border-stone-300 bg-stone-50 px-4 py-2.5 text-sm font-semibold text-stone-600 transition hover:bg-stone-100"
              >
                取消
              </button>
              <button
                type="button"
                disabled={savingVisibility}
                onClick={async () => {
                  setVisibilityError(null);
                  setSavingVisibility(true);
                  try {
                    const res = await fetch("/api/user-visibility", {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        user_email: selectedUserForVisibility!.email,
                        tables: visibilityTables,
                        columns: visibilityTables.reduce(
                          (acc, t) => {
                            acc[t] = visibilityColumns[t]?.length ? visibilityColumns[t] : ["*"];
                            return acc;
                          },
                          {} as Record<string, string[]>
                        ),
                        overview_kpis: visibilityOverviewKpis,
                      }),
                    });
                    const data = (await safeResJson(res)) as { ok?: boolean; error?: string };
                    if (!res.ok || !data.ok) {
                      setVisibilityError(data.error ?? "儲存失敗");
                      setSavingVisibility(false);
                      return;
                    }
                    setSavingVisibility(false);
                    setSelectedUserForVisibility(null);
                  } catch (err) {
                    setVisibilityError(err instanceof Error ? err.message : "儲存失敗");
                    setSavingVisibility(false);
                  }
                }}
                className="rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-bold text-slate-900 shadow-lg shadow-amber-200/30 transition hover:bg-amber-400 disabled:opacity-60"
              >
                {savingVisibility ? "儲存中..." : "儲存可見範圍"}
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* 大總表 詳情抽屜 */}
      {selectedMaster && (
        <div className="fixed inset-0 z-40 flex items-start justify-end bg-stone-900/30 backdrop-blur-sm">
          <div className="flex h-full w-full max-w-xl flex-col border-l border-stone-200/90 bg-white shadow-2xl ring-1 ring-stone-200/80">
            <header className="flex items-center justify-between border-b border-stone-200/90 bg-stone-100/90 px-6 py-4">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-stone-900">
                  專案詳情 · {selectedMaster.專案名稱 ?? selectedMaster.專案ID}
                </h2>
                <p className="mt-1.5 text-sm font-medium text-stone-500">
                  專案ID：{selectedMaster.專案ID} · 狀態：{selectedMaster.專案狀態 ?? "—"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (!isEditingMaster) {
                      setIsEditingMaster(true);
                      setSaveMasterError(null);
                      return;
                    }
                    // 取消編輯 → 還原為目前 selectedMaster 的值
                    setIsEditingMaster(false);
                    setSaveMasterError(null);
                    setEditMasterForm({
                      專案名稱: selectedMaster.專案名稱 ?? "",
                      專案類型: selectedMaster.專案類型 ?? "",
                      專案狀態: selectedMaster.專案狀態 ?? "",
                      狀態確認日期: selectedMaster.狀態確認日期 ?? "",
                      開案日期: selectedMaster.開案日期 ?? "",
                      專案資料夾: selectedMaster.專案資料夾 ?? "",
                      專案總金額未稅: selectedMaster.專案總金額未稅 ?? "",
                      專案成本: selectedMaster.專案成本 ?? "",
                      KOL費用未稅: selectedMaster.KOL費用未稅 ?? "",
                      專案營收: calc專案營收(
                        selectedMaster.專案總金額未稅 ?? "",
                        selectedMaster.專案成本 ?? "",
                        selectedMaster.KOL費用未稅 ?? ""
                      ),
                      專案費用類型: selectedMaster.專案費用類型 ?? "",
                      KOL名稱: selectedMaster.KOL名稱 ?? "",
                      廠商名稱: selectedMaster.廠商名稱 ?? "",
                      專案BDPM: selectedMaster.專案BDPM ?? "",
                      專案BDPM分潤成數: selectedMaster.專案BDPM分潤成數 ?? "",
                      專案引薦人: selectedMaster.專案引薦人 ?? "",
                      專案引薦人分潤成數: selectedMaster.專案引薦人分潤成數 ?? "",
                      專案管理員: selectedMaster.專案管理員 ?? "",
                      專案管理員分潤成數: selectedMaster.專案管理員分潤成數 ?? "",
                      執行管理員: selectedMaster.執行管理員 ?? "",
                      執行管理員分潤成數: selectedMaster.執行管理員分潤成數 ?? "",
                      專案內容: selectedMaster.專案內容 ?? "",
                      備註: selectedMaster.備註 ?? "",
                    });
                  }}
                  className="rounded-xl border border-stone-300 bg-stone-50 px-4 py-2 text-sm font-semibold text-stone-600 transition hover:bg-amber-50 hover:text-amber-800"
                >
                  {isEditingMaster ? "取消編輯" : "編輯"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedMaster(null);
                    setIsEditingMaster(false);
                    setSaveMasterError(null);
                  }}
                  className="rounded-xl border border-stone-300 bg-stone-50 px-4 py-2 text-sm font-semibold text-stone-600 transition hover:bg-amber-50 hover:text-amber-800"
                >
                  關閉
                </button>
              </div>
            </header>

            <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
              {saveMasterError && (
                <p className="rounded-lg bg-amber-100/90 px-3 py-2 text-sm font-medium text-amber-800">{saveMasterError}</p>
              )}

              {isEditingMaster && (
                <div className="flex items-center justify-end">
                  <button
                    type="button"
                    disabled={savingMaster}
                    onClick={async () => {
                      setSaveMasterError(null);
                      setSavingMaster(true);
                      try {
                        const res = await fetch("/api/master", {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          cache: "no-store",
                          body: JSON.stringify({
                            id: selectedMaster.id,
                            ...(() => {
                              const { 專案BDPM分潤成數, 專案引薦人分潤成數, 專案管理員分潤成數, 執行管理員分潤成數, ...rest } = editMasterForm;
                              return rest;
                            })(),
                            專案營收: calc專案營收(
                              editMasterForm.專案總金額未稅,
                              editMasterForm.專案成本,
                              editMasterForm.KOL費用未稅
                            ),
                          }),
                        });
                        const data = (await safeResJson(res)) as { ok?: boolean; error?: string; master?: MasterRow };
                        if (!res.ok || !data.ok || !data.master) {
                          setSaveMasterError(data.error ?? "更新失敗");
                          setSavingMaster(false);
                          return;
                        }
                        setMasterList((prev) => prev.map((r) => (r.id === data.master!.id ? data.master! : r)));
                        setSelectedMaster(data.master);
                        await refreshDashboardData(["master", "payout", "finance"]);
                        setIsEditingMaster(false);
                        setSavingMaster(false);
                      } catch (err) {
                        setSaveMasterError(err instanceof Error ? err.message : "更新失敗");
                        setSavingMaster(false);
                      }
                    }}
                    className="rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-bold text-slate-900 shadow-lg shadow-amber-200/30 transition hover:bg-amber-400 disabled:opacity-60"
                  >
                    {savingMaster ? "儲存中..." : "儲存變更"}
                  </button>
                </div>
              )}

              <section>
                <h3 className="mb-3 text-base font-bold text-amber-800">基本資料</h3>
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <Field label="專案ID" value={selectedMaster.專案ID} />
                  {isEditingMaster ? (
                    <InputField label="專案名稱" value={editMasterForm.專案名稱} onChange={(v) => setEditMasterForm((f) => ({ ...f, 專案名稱: v }))} />
                  ) : (
                    <Field label="專案名稱" value={selectedMaster.專案名稱} />
                  )}
                  {isEditingMaster ? (
                    <SelectField
                      label="專案類型"
                      value={editMasterForm.專案類型}
                      onChange={(v) => setEditMasterForm((f) => ({ ...f, 專案類型: v }))}
                      options={[...new Set([...projectTypesOptions, editMasterForm.專案類型].filter(Boolean))]}
                    />
                  ) : (
                    <Field label="專案類型" value={selectedMaster.專案類型} />
                  )}
                  {isEditingMaster ? (
                    <InputField label="專案狀態" value={editMasterForm.專案狀態} onChange={(v) => setEditMasterForm((f) => ({ ...f, 專案狀態: v }))} />
                  ) : (
                    <Field label="專案狀態" value={selectedMaster.專案狀態} />
                  )}
                  {isEditingMaster ? (
                    <DateField label="開案日期" value={editMasterForm.開案日期} onChange={(v) => setEditMasterForm((f) => ({ ...f, 開案日期: v }))} />
                  ) : (
                    <Field label="開案日期" value={selectedMaster.開案日期} />
                  )}
                  {isEditingMaster ? (
                    <DateField label="狀態確認日期" value={editMasterForm.狀態確認日期} onChange={(v) => setEditMasterForm((f) => ({ ...f, 狀態確認日期: v }))} />
                  ) : (
                    <Field label="狀態確認日期" value={selectedMaster.狀態確認日期} />
                  )}
                  {isEditingMaster ? (
                    <InputField label="專案資料夾" value={editMasterForm.專案資料夾} onChange={(v) => setEditMasterForm((f) => ({ ...f, 專案資料夾: v }))} className="col-span-2" />
                  ) : (
                    <div className="col-span-2">
                      <Field label="專案資料夾" value={selectedMaster.專案資料夾} />
                    </div>
                  )}
                </div>
              </section>

              <section>
                <h3 className="mb-3 text-base font-bold text-amber-800">金額與成本</h3>
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  {isEditingMaster ? (
                    <NumberField
                      label="專案總金額未稅"
                      value={editMasterForm.專案總金額未稅}
                      onChange={(v) =>
                        setEditMasterForm((f) => ({
                          ...f,
                          專案總金額未稅: v,
                          專案營收: calc專案營收(v, f.專案成本, f.KOL費用未稅),
                        }))
                      }
                    />
                  ) : (
                    <Field label="專案總金額未稅" value={formatAmount(selectedMaster.專案總金額未稅)} />
                  )}

                  {isEditingMaster ? (
                    <div>
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">專案營收</p>
                      <p className="text-sm font-medium text-stone-700 tabular-nums">{formatAmount(editMasterForm.專案營收)}</p>
                      <p className="mt-1 text-xs text-stone-500">自動計算：專案總金額未稅 − 專案成本 − KOL費用未稅</p>
                    </div>
                  ) : (
                    <Field label="專案營收" value={formatAmount(selectedMaster.專案營收)} />
                  )}

                  {isEditingMaster ? (
                    <NumberField
                      label="專案成本"
                      value={editMasterForm.專案成本}
                      onChange={(v) =>
                        setEditMasterForm((f) => ({
                          ...f,
                          專案成本: v,
                          專案營收: calc專案營收(f.專案總金額未稅, v, f.KOL費用未稅),
                        }))
                      }
                    />
                  ) : (
                    <Field label="專案成本" value={formatAmount(selectedMaster.專案成本)} />
                  )}

                  {isEditingMaster ? (
                    <NumberField
                      label="KOL費用未稅"
                      value={editMasterForm.KOL費用未稅}
                      onChange={(v) =>
                        setEditMasterForm((f) => ({
                          ...f,
                          KOL費用未稅: v,
                          專案營收: calc專案營收(f.專案總金額未稅, f.專案成本, v),
                        }))
                      }
                    />
                  ) : (
                    <Field label="KOL費用未稅" value={formatAmount(selectedMaster.KOL費用未稅)} />
                  )}

                  {isEditingMaster ? (
                    <InputField
                      label="專案費用類型"
                      value={editMasterForm.專案費用類型}
                      onChange={(v) => setEditMasterForm((f) => ({ ...f, 專案費用類型: v }))}
                      className="col-span-2"
                    />
                  ) : (
                    <div className="col-span-2">
                      <Field label="專案費用類型" value={selectedMaster.專案費用類型} />
                    </div>
                  )}
                </div>
              </section>

              <section>
                <h3 className="mb-3 text-base font-bold text-amber-800">人員與分潤設定</h3>
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  {isEditingMaster ? (
                    <InputField label="KOL名稱" value={editMasterForm.KOL名稱} onChange={(v) => setEditMasterForm((f) => ({ ...f, KOL名稱: v }))} />
                  ) : (
                    <Field label="KOL名稱" value={selectedMaster.KOL名稱} />
                  )}
                  {isEditingMaster ? (
                    <InputField label="廠商名稱" value={editMasterForm.廠商名稱} onChange={(v) => setEditMasterForm((f) => ({ ...f, 廠商名稱: v }))} />
                  ) : (
                    <Field label="廠商名稱" value={selectedMaster.廠商名稱} />
                  )}
                  {isPayoutModeB(isEditingMaster ? editMasterForm.專案類型 : selectedMaster.專案類型 ?? "") ? (
                    <>
                      {isEditingMaster ? (
                        <SelectField label="專案引薦人" value={editMasterForm.專案引薦人} onChange={(v) => setEditMasterForm((f) => ({ ...f, 專案引薦人: v }))} options={userNames} />
                      ) : (
                        <Field label="專案引薦人" value={selectedMaster.專案引薦人} />
                      )}
                      <Field label="專案引薦人分潤成數" value={payoutDefaults.專案引薦人分潤成數} />
                      <Field label="經紀人（由 KOL 帶出）" value={partners.find((p) => p.合作夥伴名稱 === (isEditingMaster ? editMasterForm.KOL名稱 : selectedMaster.KOL名稱))?.經紀人 ?? "—"} />
                      <Field label="經紀人分潤成數" value={payoutDefaults.經紀人分潤成數} />
                      <Field label="主管（由 KOL 帶出）" value={partners.find((p) => p.合作夥伴名稱 === (isEditingMaster ? editMasterForm.KOL名稱 : selectedMaster.KOL名稱))?.主管 ?? "—"} />
                      <Field label="主管分潤成數" value={payoutDefaults.主管分潤成數} />
                      <Field label="KOL開發者（由 KOL 帶出）" value={partners.find((p) => p.合作夥伴名稱 === (isEditingMaster ? editMasterForm.KOL名稱 : selectedMaster.KOL名稱))?.KOL開發者 ?? "—"} />
                      <Field label="KOL開發者分潤成數" value={payoutDefaults.KOL開發者分潤成數} />
                    </>
                  ) : (
                    <>
                      {isEditingMaster ? (
                        <SelectField
                          label="專案BDPM"
                          value={editMasterForm.專案BDPM}
                          onChange={(v) => setEditMasterForm((f) => ({ ...f, 專案BDPM: v }))}
                          options={[...new Set([...userNames, editMasterForm.專案BDPM].filter(Boolean))]}
                        />
                      ) : (
                        <Field label="專案BDPM" value={selectedMaster.專案BDPM} />
                      )}
                      <Field label="專案BDPM分潤成數" value={payoutDefaults.專案BDPM分潤成數} />
                      {isEditingMaster ? (
                        <SelectField label="專案引薦人" value={editMasterForm.專案引薦人} onChange={(v) => setEditMasterForm((f) => ({ ...f, 專案引薦人: v }))} options={userNames} />
                      ) : (
                        <Field label="專案引薦人" value={selectedMaster.專案引薦人} />
                      )}
                      <Field label="專案引薦人分潤成數" value={payoutDefaults.專案引薦人分潤成數} />
                      {isEditingMaster ? (
                        <SelectField label="專案管理員" value={editMasterForm.專案管理員} onChange={(v) => setEditMasterForm((f) => ({ ...f, 專案管理員: v }))} options={userNames} />
                      ) : (
                        <Field label="專案管理員" value={selectedMaster.專案管理員} />
                      )}
                      <Field label="專案管理員分潤成數" value={payoutDefaults.專案管理員分潤成數} />
                      {isEditingMaster ? (
                        <SelectField label="執行管理員" value={editMasterForm.執行管理員} onChange={(v) => setEditMasterForm((f) => ({ ...f, 執行管理員: v }))} options={userNames} />
                      ) : (
                        <Field label="執行管理員" value={selectedMaster.執行管理員} />
                      )}
                      <Field label="執行管理員分潤成數" value={payoutDefaults.執行管理員分潤成數} />
                      <Field label="KOL開發者分潤成數" value={payoutDefaults.KOL開發者分潤成數} />
                    </>
                  )}
                </div>
              </section>

              <section>
                <h3 className="mb-3 text-base font-bold text-amber-800">內容與備註</h3>
                {isEditingMaster ? (
                  <div className="space-y-4">
                    <TextAreaField label="專案內容" value={editMasterForm.專案內容} onChange={(v) => setEditMasterForm((f) => ({ ...f, 專案內容: v }))} />
                    <TextAreaField label="備註" value={editMasterForm.備註} onChange={(v) => setEditMasterForm((f) => ({ ...f, 備註: v }))} />
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500">專案內容</p>
                      <p className="whitespace-pre-wrap rounded-xl border border-stone-200/90 bg-stone-50 px-4 py-3 text-sm font-medium text-stone-700">
                        {selectedMaster.專案內容 || "—"}
                      </p>
                    </div>
                    <div>
                      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500">備註</p>
                      <p className="whitespace-pre-wrap rounded-xl border border-stone-200/90 bg-stone-50 px-4 py-3 text-sm font-medium text-stone-700">
                        {selectedMaster.備註 || "—"}
                      </p>
                    </div>
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      )}

      {/* 任務 編輯抽屜 */}
      {selectedTask && (
        <div className="fixed inset-0 z-40 flex items-start justify-end bg-stone-900/30 backdrop-blur-sm">
          <div className="flex h-full w-full max-w-md flex-col border-l border-stone-200/90 bg-white shadow-2xl ring-1 ring-stone-200/80">
            <header className="flex items-center justify-between border-b border-stone-200/90 bg-stone-100/90 px-6 py-4">
              <h2 className="text-xl font-bold tracking-tight text-stone-900">編輯任務</h2>
              <button
                type="button"
                onClick={() => { setSelectedTask(null); setSaveTaskError(null); }}
                className="rounded-xl border border-stone-300 bg-stone-50 px-4 py-2 text-sm font-semibold text-stone-600 transition hover:bg-stone-100"
              >
                關閉
              </button>
            </header>
            <form
              className="flex flex-1 flex-col overflow-y-auto px-6 py-5"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!selectedTask.任務ID) return;
                setSaveTaskError(null);
                setSavingTask(true);
                try {
                  const res = await fetch("/api/tasks", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      任務ID: selectedTask.任務ID,
                      任務名稱: editTaskForm.任務名稱.trim() || null,
                      任務狀態: editTaskForm.任務狀態.trim() || null,
                      負責人: editTaskForm.任務負責人.trim() || null,
                      任務完成: editTaskForm.任務完成,
                    }),
                  });
                  const data = (await safeResJson(res)) as { ok?: boolean; error?: string; task?: TaskRow };
                  if (!res.ok || !data.ok || !data.task) {
                    setSaveTaskError(data.error ?? "更新失敗");
                    setSavingTask(false);
                    return;
                  }
                  setTasks((prev) => prev.map((x) => (x.任務ID === selectedTask.任務ID ? data.task! : x)));
                  setSelectedTask(data.task);
                  await refreshDashboardData(["tasks"]);
                  setEditTaskForm({
                    任務名稱: data.task.任務 ?? "",
                    任務狀態: data.task.狀態 ?? "",
                    任務負責人: data.task.任務負責人 ?? "",
                    任務完成: Boolean(data.task.任務完成),
                  });
                } catch (err: unknown) {
                  setSaveTaskError(err instanceof Error ? err.message : "更新失敗");
                }
                setSavingTask(false);
              }}
            >
              {saveTaskError && <p className="mb-4 rounded-lg bg-amber-100/90 px-3 py-2 text-sm text-amber-800">{saveTaskError}</p>}
              <div className="mb-4 space-y-1">
                <p className="text-xs font-medium text-stone-500">專案ID：{selectedTask.專案ID ?? "—"}</p>
                <p className="text-sm font-semibold text-amber-800">{selectedTask.專案名稱 ?? "—"}</p>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-stone-500">任務名稱</label>
                  <input
                    type="text"
                    value={editTaskForm.任務名稱}
                    onChange={(e) => setEditTaskForm((f) => ({ ...f, 任務名稱: e.target.value }))}
                    className="w-full rounded-xl border border-stone-300 bg-stone-50 px-3 py-2.5 text-sm font-medium text-stone-900 focus:border-amber-400/70 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-stone-500">狀態</label>
                  <input
                    type="text"
                    value={editTaskForm.任務狀態}
                    onChange={(e) => setEditTaskForm((f) => ({ ...f, 任務狀態: e.target.value }))}
                    className="w-full rounded-xl border border-stone-300 bg-stone-50 px-3 py-2.5 text-sm font-medium text-stone-900 focus:border-amber-400/70 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                    placeholder="如：進行中"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-stone-500">任務負責人</label>
                  <select
                    value={editTaskForm.任務負責人}
                    onChange={(e) => setEditTaskForm((f) => ({ ...f, 任務負責人: e.target.value }))}
                    className="w-full rounded-xl border border-stone-300 bg-stone-50 px-3 py-2.5 text-sm font-medium text-stone-900 focus:border-amber-400/70 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                  >
                    <option value="">— 未指定 —</option>
                    {userNames.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>
                <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 transition hover:bg-stone-100">
                  <input
                    type="checkbox"
                    checked={editTaskForm.任務完成}
                    onChange={(e) => setEditTaskForm((f) => ({ ...f, 任務完成: e.target.checked }))}
                    className="h-5 w-5 rounded border-stone-300 bg-stone-50 text-amber-500 focus:ring-amber-500/50"
                  />
                  <span className="text-sm font-medium text-stone-700">任務完成</span>
                </label>
              </div>
              <div className="mt-8">
                <button
                  type="submit"
                  disabled={savingTask}
                  className="w-full rounded-xl bg-amber-500 py-3 text-sm font-bold text-slate-900 shadow-lg shadow-amber-200/30 transition hover:bg-amber-400 disabled:opacity-60"
                >
                  {savingTask ? "儲存中…" : "儲存"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

interface FieldProps {
  label: string;
  value: string | null | undefined;
}

function Field({ label, value }: FieldProps) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</p>
      <p className="text-sm font-medium text-stone-700">{value && String(value).trim() ? value : "—"}</p>
    </div>
  );
}

interface InputFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  className?: string;
}

function InputField({ label, value, onChange, type = "text", className = "" }: InputFieldProps) {
  return (
    <div className={className}>
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</label>
      <input
        type={type}
        className="w-full rounded-xl border border-stone-300 bg-stone-50 px-3 py-2.5 text-sm font-medium text-stone-900 placeholder:text-stone-500 focus:border-amber-400/70 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

interface NumberFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

function NumberField({ label, value, onChange, className = "" }: NumberFieldProps) {
  return (
    <div className={className}>
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</label>
      <input
        type="number"
        inputMode="decimal"
        step="0.01"
        min={0}
        className="w-full rounded-xl border border-stone-300 bg-stone-50 px-3 py-2.5 text-sm font-medium text-stone-900 tabular-nums placeholder:text-stone-500 focus:border-amber-400/70 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

interface SelectFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  className?: string;
}

function SelectField({ label, value, onChange, options, className = "" }: SelectFieldProps) {
  return (
    <div className={className}>
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</label>
      <select
        className="w-full rounded-xl border border-stone-300 bg-stone-50 px-3 py-2.5 text-sm font-medium text-stone-900 focus:border-amber-400/70 focus:outline-none focus:ring-2 focus:ring-amber-500/20 [color-scheme:light]"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">請選擇</option>
        {options.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </div>
  );
}

interface DateFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

function DateField({ label, value, onChange }: DateFieldProps) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</label>
      <input
        type="date"
        className="w-full rounded-xl border border-stone-300 bg-stone-50 px-3 py-2.5 text-sm font-medium text-stone-900 outline-none transition focus:border-amber-400/70 focus:ring-2 focus:ring-amber-500/20 [color-scheme:light]"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

interface TextAreaFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

function TextAreaField({ label, value, onChange }: TextAreaFieldProps) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</label>
      <textarea
        className="w-full rounded-xl border border-stone-300 bg-stone-50 px-3 py-2.5 text-sm font-medium text-stone-900 placeholder:text-stone-500 focus:border-amber-400/70 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
        rows={3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

