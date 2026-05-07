"use client";

import { Fragment, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { User } from "@/lib/types";
import type { TaskRow } from "@/modules/tasks";
import type { PartnerRow } from "@/modules/partners";
import type { MasterRow } from "@/lib/db/master";
import type { InvoiceRow, InvoiceInsertInput, FinanceRow, PaymentRecordInput, PaymentRecordRow } from "@/modules/finance";
import type { FinanceUpdateFields } from "@/lib/db/finance";
import type { PayoutRow } from "@/lib/db/payout";
import { applyDedupeRules } from "@/lib/payout-dedupe";
import { getSectionsForRole, isFullAccessRole, ROLE_VISIBILITY, ROLES } from "@/config/role-visibility";
import { PROJECT_TYPES, costFromTotalByProjectType } from "@/config/project-types";
import { DEFAULT_PROJECT_STATUS_OPTIONS } from "@/config/project-status-defaults";
import { DEFAULT_PROJECT_EXPENSE_TYPE_OPTIONS } from "@/config/project-expense-type-defaults";
import { DEFAULT_TASK_TYPE_OPTIONS } from "@/config/task-type-defaults";
import { MASTER_PAYOUT_DEFAULTS, isPayoutModeB } from "@/config/master-payout-defaults";
import { DEFAULT_PAYOUT_DEDUPE_RULES, type PayoutDedupeRulesByMode } from "@/config/payout-dedupe-defaults";
import { TABLE_KEYS, TABLE_LABELS, TABLE_COLUMNS, ROLE_SECTION_KEYS_FOR_UI } from "@/config/table-columns";
import {
  OVERVIEW_KPI_KEYS,
  OVERVIEW_KPI_LABELS,
  getDefaultOverviewKpisForRole,
  type OverviewKpiKey,
} from "@/config/overview-kpi";
import { SocialLinkIcons } from "@/components/SocialLinkIcons";
import { PARTNER_STATUS, isPartnerAgentBlockedKey } from "@/lib/db/partner-approval";
import { normalizeDecimalString } from "@/lib/number-normalize";
import { TASK_DUE_SOON_DAYS } from "@/config/task-due";
import {
  aggregateTasksByAssignee,
  dueDaysFromToday,
  filterTasksForWorkloadDrill,
  getTaskDueUiStatus,
  workloadDrillKindLabel,
  type WorkloadDrillKind,
} from "@/lib/task-due";

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

/** KOL 帳號 scope 存 PartnerID；選單選項為「ID — 合作夥伴名稱」 */
function kolPartnerSelectOptions(partners: PartnerRow[]): string[] {
  const rows = partners
    .filter((p) => String(p.PartnerID ?? "").trim())
    .map((p) => `${String(p.PartnerID).trim()} — ${String(p.合作夥伴名稱 ?? "").trim()}`)
    .sort((a, b) => a.localeCompare(b, "zh-TW"));
  return [...new Set(rows)];
}

function parseKolPartnerOptionToScope(opt: string): string {
  const s = opt.trim();
  if (!s) return "";
  const sep = " — ";
  const i = s.indexOf(sep);
  return i === -1 ? s : s.slice(0, i).trim();
}

function kolScopeButtonLabel(scopeStored: string, options: string[]): string {
  const id = String(scopeStored ?? "").trim();
  if (!id) return "";
  const hit = options.find((o) => o.startsWith(`${id} — `) || parseKolPartnerOptionToScope(o) === id);
  return hit ?? id;
}

/** 專案營收 = 專案總金額未稅 - 專案成本 - KOL費用未稅 */
function calc專案營收(總金額: string, 成本: string, kol費用: string): string {
  const a = Number(總金額) || 0;
  const b = Number(成本) || 0;
  const c = Number(kol費用) || 0;
  return normalizeDecimalString(a - b - c, 2) ?? "0";
}

/** 分潤表欄位顯示順序（所有人一致）：分潤金額 → 分潤成數、專案名稱 → 其餘 */
const PAYOUT_DISPLAY_ORDER = [
  "分潤金額",
  "分潤成數",
  "專案名稱",
  "專案ID",
  "廠商預計付款日",
  "廠商付款日期",
  "分潤匯款日期",
  "專案營收",
  "專案總金額未稅",
  "分潤類型",
  "領取人",
] as const;

/** ③ 可見欄位儲存舊 key 時對應到新欄位 */
const PAYOUT_COLUMN_LEGACY_MAP: Record<string, string> = {
  專案預計匯款日: "廠商預計付款日",
  專案實際入帳日期: "廠商付款日期",
};

function normalizePayoutVisibleKeys(keys: string[]): string[] {
  return [...new Set(keys.map((k) => PAYOUT_COLUMN_LEGACY_MAP[k] ?? k))];
}

function sortPayoutColumnsForDisplay(cols: string[]): string[] {
  return [...cols].sort((a, b) => {
    const ia = PAYOUT_DISPLAY_ORDER.indexOf(a as (typeof PAYOUT_DISPLAY_ORDER)[number]);
    const ib = PAYOUT_DISPLAY_ORDER.indexOf(b as (typeof PAYOUT_DISPLAY_ORDER)[number]);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });
}

const RENDER_CHUNK_SIZE = 120;
type MasterCreatedSortDirection = "desc" | "asc";

/** 金額顯示用（數字型態，千分位） */
function formatAmount(v: string | null | undefined): string {
  if (v == null || String(v).trim() === "") return "—";
  const n = Number(String(v).replace(/,/g, ""));
  if (Number.isNaN(n)) return String(v);
  return n.toLocaleString("zh-TW");
}

/** 任務時間戳顯示（Asia/Taipei，後端存 ISO） */
function formatTaskDisplayTime(iso: string | null | undefined): string {
  if (iso == null || String(iso).trim() === "") return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function sortMasterRowsByCreatedAt(rows: MasterRow[], direction: MasterCreatedSortDirection): MasterRow[] {
  return [...rows].sort((a, b) => {
    const ta = Date.parse(a.created_at ?? "") || 0;
    const tb = Date.parse(b.created_at ?? "") || 0;
    if (ta !== tb) return direction === "desc" ? tb - ta : ta - tb;
    return direction === "desc"
      ? String(b.專案ID ?? "").localeCompare(String(a.專案ID ?? ""), "zh-TW")
      : String(a.專案ID ?? "").localeCompare(String(b.專案ID ?? ""), "zh-TW");
  });
}

function formatTaskDueYmd(ymd: string | null | undefined): string {
  const s = String(ymd ?? "").trim();
  if (!s) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return s;
  return `${m[1]}/${m[2]}/${m[3]}`;
}

function formatTaskDueShortHint(t: TaskRow): string {
  if (t.任務完成 || !t.到期日?.trim()) return "";
  const d = dueDaysFromToday(t.到期日);
  if (d === null) return "";
  if (d < 0) return `逾期 ${-d} 天`;
  if (d <= TASK_DUE_SOON_DAYS) return `剩 ${d} 天`;
  return "";
}

/** 新增／批次發票表單欄位順序（與 TABLE_COLUMNS.invoices 一致） */
const INVOICE_DRAFT_KEYS = [
  "專案ID",
  "發票號碼",
  "發票日期",
  "收款對象",
  "發票金額含稅",
  "廠商預計付款日",
  "廠商付款日期",
  "備註",
] as const;

function emptyInvoiceDraftRow(): Record<string, string> {
  return Object.fromEntries(INVOICE_DRAFT_KEYS.map((k) => [k, ""])) as Record<string, string>;
}

type InvoiceDraftKey = (typeof INVOICE_DRAFT_KEYS)[number];

const INVOICE_IMPORT_HEADER_ALIASES: Record<string, InvoiceDraftKey> = {
  專案id: "專案ID",
  專案ID: "專案ID",
  對應專案: "專案ID",
  projectid: "專案ID",
  project_id: "專案ID",
  發票號碼: "發票號碼",
  發票編號: "發票號碼",
  憑證號碼: "發票號碼",
  發票日期: "發票日期",
  發票開立日: "發票日期",
  發票開立日期: "發票日期",
  開立日期: "發票日期",
  收款對象: "收款對象",
  付款方: "收款對象",
  客戶名稱: "收款對象",
  客戶: "收款對象",
  發票金額含稅: "發票金額含稅",
  含稅金額: "發票金額含稅",
  收款金額: "發票金額含稅",
  金額: "發票金額含稅",
  廠商預計付款日: "廠商預計付款日",
  預計付款日: "廠商預計付款日",
  預計收款日: "廠商預計付款日",
  廠商付款日期: "廠商付款日期",
  收款日期: "廠商付款日期",
  實際收款日: "廠商付款日期",
  付款日期: "廠商付款日期",
  備註: "備註",
  note: "備註",
  notes: "備註",
};

function normalizeInvoiceImportHeader(header: string): string {
  return String(header ?? "").replace(/[\s　｜|/\\()（）:_-]/g, "").trim().toLowerCase();
}

function parseDelimitedLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === delimiter && !quoted) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

function parseInvoiceImportText(text: string): {
  headers: string[];
  mappedKeys: Array<InvoiceDraftKey | "">;
  rows: Record<string, string>[];
  error: string | null;
} {
  const rawLines = String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => line.trim() !== "");
  if (rawLines.length === 0) return { headers: [], mappedKeys: [], rows: [], error: null };
  if (rawLines.length < 2) return { headers: [], mappedKeys: [], rows: [], error: "請貼上含標題列與至少一筆資料的表格" };

  const delimiter = rawLines.some((line) => line.includes("\t")) ? "\t" : ",";
  const headers = parseDelimitedLine(rawLines[0], delimiter);
  const mappedKeys = headers.map((h) => INVOICE_IMPORT_HEADER_ALIASES[normalizeInvoiceImportHeader(h)] ?? "");
  const rows = rawLines.slice(1).map((line) => {
    const cells = parseDelimitedLine(line, delimiter);
    const row = emptyInvoiceDraftRow();
    mappedKeys.forEach((key, idx) => {
      if (!key) return;
      row[key] = cells[idx] ?? "";
    });
    return row;
  }).filter((row) => INVOICE_DRAFT_KEYS.some((key) => String(row[key] ?? "").trim() !== ""));

  return {
    headers,
    mappedKeys,
    rows,
    error: rows.length === 0 ? "沒有解析到可匯入的資料列" : null,
  };
}

function invoiceMonthKey(row: InvoiceRow): string {
  const invoiceDate = String(row.發票日期 ?? "").trim();
  const paymentDate = String(row.廠商付款日期 ?? "").trim();
  const raw = invoiceDate || paymentDate;
  const iso = normalizeDateForInput(raw);
  if (iso) return iso.slice(0, 7);
  return "未分類";
}

function invoiceMonthLabel(key: string): string {
  if (key === "all") return "全部";
  if (key === "未分類") return "未分類";
  const [year, month] = key.split("-");
  if (!year || !month) return key;
  return `${year}/${month}`;
}

const PAYMENT_RECORD_KEYS = ["發票號碼", "付款日期", "付款專案", "付款對象", "付款金額", "備註"] as const;

function emptyPaymentRecordDraftRow(): Record<string, string> {
  return Object.fromEntries(PAYMENT_RECORD_KEYS.map((k) => [k, ""])) as Record<string, string>;
}

type InvoiceProjectOption = {
  id: string;
  name: string;
  searchText: string;
};

function invoiceProjectDisplayName(option: InvoiceProjectOption | undefined, fallbackId: string): string {
  if (!option) return fallbackId;
  return option.name || option.id;
}

function InvoiceProjectSearchSelect({
  value,
  options,
  disabled,
  onChange,
  onBlur,
}: {
  value: string;
  options: InvoiceProjectOption[];
  disabled?: boolean;
  onChange: (projectId: string) => void;
  onBlur?: () => void;
}) {
  const normalizedValue = String(value ?? "").trim();
  const selected = options.find((opt) => opt.id === normalizedValue);
  const [query, setQuery] = useState(() => invoiceProjectDisplayName(selected, normalizedValue));
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setQuery(invoiceProjectDisplayName(selected, normalizedValue));
  }, [normalizedValue, selected]);

  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q
      ? options.filter((opt) => opt.searchText.toLowerCase().includes(q))
      : options;
    return rows.slice(0, 30);
  }, [options, query]);

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        disabled={disabled}
        placeholder="搜尋專案名稱"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          const next = e.target.value;
          setQuery(next);
          setOpen(true);
          if (next.trim() === "") onChange("");
        }}
        onBlur={() => {
          window.setTimeout(() => {
            setOpen(false);
            const current = options.find((opt) => opt.id === String(value ?? "").trim());
            setQuery(invoiceProjectDisplayName(current, String(value ?? "").trim()));
            onBlur?.();
          }, 120);
        }}
        className="w-full min-w-[10rem] rounded border border-stone-200 bg-white px-2 py-1.5 text-xs font-medium text-stone-900 placeholder:text-stone-400 focus:border-amber-500/60 focus:outline-none disabled:opacity-60"
      />
      {open && !disabled && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-56 w-72 overflow-auto rounded-lg border border-stone-200 bg-white py-1 text-xs shadow-xl">
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              onChange("");
              setQuery("");
              setOpen(false);
            }}
            className="block w-full px-3 py-2 text-left text-stone-500 hover:bg-amber-50 hover:text-stone-900"
          >
            不綁定專案
          </button>
          {filteredOptions.length === 0 ? (
            <div className="px-3 py-2 text-stone-400">沒有符合的專案</div>
          ) : (
            filteredOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(opt.id);
                  setQuery(invoiceProjectDisplayName(opt, opt.id));
                  setOpen(false);
                }}
                className="block w-full px-3 py-2 text-left hover:bg-amber-50"
              >
                <span className="block truncate font-medium text-stone-900">{opt.name || opt.id}</span>
                <span className="block truncate text-[10px] text-stone-500">{opt.id}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function TaskProjectInfoButton({ project }: { project: MasterRow | undefined }) {
  if (!project) return null;
  const fields = [
    ["專案總金額未稅", formatAmount(project.專案總金額未稅)],
    ["專案狀態", project.專案狀態 || "—"],
    ["廠商名稱", project.廠商名稱 || "—"],
    ["預計付款日", formatPartnerDateDisplay(project.廠商預計付款日)],
    ["專案成本", formatAmount(project.專案成本)],
    ["專案營收", formatAmount(project.專案營收)],
  ] as const;

  return (
    <span className="group relative inline-flex" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-amber-300 bg-amber-50 text-[11px] font-bold text-amber-800 shadow-sm transition hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-300/70"
        aria-label="查看專案資訊"
      >
        i
      </button>
      <span className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 hidden w-72 -translate-x-1/2 rounded-xl border border-amber-200 bg-white p-3 text-left text-xs shadow-2xl ring-1 ring-stone-200/70 group-hover:block group-focus-within:block">
        <span className="mb-2 block border-b border-stone-100 pb-2">
          <span className="block truncate text-sm font-bold text-stone-900">{project.專案名稱 || project.專案ID}</span>
          <span className="mt-0.5 block truncate text-[11px] text-stone-500">{project.專案ID}</span>
        </span>
        <span className="grid grid-cols-2 gap-x-3 gap-y-2">
          {fields.map(([label, value]) => (
            <span key={label} className="min-w-0">
              <span className="block text-[10px] font-semibold text-stone-400">{label}</span>
              <span className="mt-0.5 block truncate font-medium text-stone-700">{value}</span>
            </span>
          ))}
        </span>
        {project.專案內容 ? (
          <span className="mt-2 block border-t border-stone-100 pt-2">
            <span className="block text-[10px] font-semibold text-stone-400">專案內容</span>
            <span className="mt-0.5 block line-clamp-3 whitespace-normal text-stone-600">{project.專案內容}</span>
          </span>
        ) : null}
      </span>
    </span>
  );
}

function invoiceRowToInsertInput(row: InvoiceRow): InvoiceInsertInput {
  return {
    專案ID: row.專案ID ?? "",
    發票號碼: row.發票號碼 ?? "",
    發票日期: row.發票日期 ?? "",
    收款對象: row.收款對象 ?? "",
    發票金額含稅: row.發票金額含稅 ?? "",
    廠商預計付款日: row.廠商預計付款日 ?? "",
    廠商付款日期: row.廠商付款日期 ?? "",
    備註: row.備註 ?? "",
  };
}

function paymentRecordRowToInput(row: PaymentRecordRow): PaymentRecordInput {
  return {
    發票號碼: row.發票號碼 ?? "",
    付款日期: row.付款日期 ?? "",
    付款專案: row.付款專案 ?? "",
    付款對象: row.付款對象 ?? "",
    付款金額: row.付款金額 ?? "",
    備註: row.備註 ?? "",
  };
}

function financeRowToUpdatePayload(row: FinanceRow): FinanceUpdateFields {
  const r = row as Record<string, string | undefined>;
  return {
    廠商付款日期: r.廠商付款日期 ?? "",
    員工分潤日期: r.員工分潤日期 ?? "",
  };
}

function isFinanceByProjectEditableColumn(k: string): boolean {
  return k === "廠商付款日期" || k === "員工分潤日期";
}

const LS_INVOICE_PREFIX = "sdh-invoice-seq-prefix";
const LS_INVOICE_PAD = "sdh-invoice-seq-pad";
const LS_INVOICE_NEXT = "sdh-invoice-seq-next";

/** 連號：前綴 + 數字（可補零）；起始與遞增皆為非負整數 */
function buildSequentialInvoiceNumbers(prefix: string, startInt: number, count: number, padDigits: number): string[] {
  if (!Number.isFinite(startInt) || count < 1) return [];
  const out: string[] = [];
  const p = prefix.trim();
  const pad = padDigits > 0 ? Math.min(32, Math.floor(padDigits)) : 0;
  for (let i = 0; i < count; i++) {
    const n = Math.floor(startInt) + i;
    if (n < 0) continue;
    const numStr = pad > 0 ? String(n).padStart(pad, "0") : String(n);
    out.push(`${p}${numStr}`);
  }
  return out;
}

function parseNumericField(v: string | null | undefined): number {
  if (v == null || String(v).trim() === "") return 0;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

type InvoiceSummary = {
  rows: InvoiceRow[];
  count: number;
  totalAmount: number;
  paidAmount: number;
  unpaidAmount: number;
  status: string;
};

function buildInvoiceSummary(rows: InvoiceRow[]): InvoiceSummary {
  let totalAmount = 0;
  let paidAmount = 0;
  for (const row of rows) {
    const amount = parseNumericField(row.發票金額含稅);
    totalAmount += amount;
    if (String(row.廠商付款日期 ?? "").trim()) paidAmount += amount;
  }
  const unpaidAmount = totalAmount - paidAmount;
  const status =
    rows.length === 0
      ? "未開票"
      : paidAmount <= 0
        ? "已開票未收"
        : unpaidAmount <= 0
          ? "已收款"
          : "部分收款";
  return { rows, count: rows.length, totalAmount, paidAmount, unpaidAmount, status };
}

function invoiceSummarySearchText(summary: InvoiceSummary | undefined): string {
  if (!summary || summary.count === 0) return "未開票";
  return [
    summary.status,
    `${summary.count}張`,
    `含稅${Math.round(summary.totalAmount)}`,
    `已收${Math.round(summary.paidAmount)}`,
    `未收${Math.round(summary.unpaidAmount)}`,
  ].join(" ");
}

/** 將常見日期字串轉成 yyyy-MM-dd 供 input type="date" */
function toHtmlDateValue(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{4})[/.年\-](\d{1,2})[/.月\-](\d{1,2})/);
  if (m) {
    const y = m[1];
    const mo = m[2].padStart(2, "0");
    const d = m[3].replace(/日$/, "").padStart(2, "0");
    return `${y}-${mo}-${d}`;
  }
  return "";
}

/** 展開列顯示：本地化日期或可讀原字 */
function formatPartnerDateDisplay(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim();
  if (!s) return "—";
  const iso = toHtmlDateValue(s);
  if (iso) {
    const d = new Date(`${iso}T12:00:00`);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit" });
    }
  }
  return s;
}

/** KOL 展開列：分組標題與欄位 key（主表不顯示的詳細欄位集中於此） */
const PARTNER_EXPAND_SECTION_KEYS: { title: string; keys: string[] }[] = [
  { title: "識別與分類", keys: ["PartnerID", "合作夥伴名稱", "類別一", "類別二", "類別三"] },
  { title: "聯絡與管道", keys: ["社群網站", "Email", "資料夾", "粉絲數", "頻道｜節目名稱"] },
  { title: "分潤與合約", keys: ["自來件分潤", "SDH開發分件分潤", "經銷約開始日", "經銷約結束日"] },
  { title: "人員", keys: ["KOL開發者", "主管"] },
  { title: "夥伴類型與其他", keys: ["分級", "是否有經營 私域群", "廣告經銷夥伴", "節目製作夥伴", "課程製作夥伴"] },
];

function masterRowUntaxedTotal(row: MasterRow): number {
  return parseNumericField(row.專案總金額未稅);
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
const MASTER_RELATED_FIELD_KEYS = ["專案BDPM", "專案引薦人", "專案開發人", "專案管理員", "執行管理員", "KOL名稱", "經紀人"] as const;

function fieldMatchesUser(val: string | null | undefined, userName: string, userEmail: string): boolean {
  const v = String(val ?? "").trim();
  if (!v) return false;
  return v === userName || v === userEmail;
}

function isMasterRowRelatedToUser(
  row: MasterRow,
  userName: string,
  userEmail: string,
  projectIdsFromMyTasks: Set<string>,
  partnerByKolName: Map<string, PartnerRow>
): boolean {
  if (!userName && !userEmail) return false;
  if (isPayoutModeB(String(row.專案類型 ?? ""))) {
    if (fieldMatchesUser(row.專案開發人, userName, userEmail)) return true;
  } else {
    if (fieldMatchesUser(row.專案引薦人, userName, userEmail)) return true;
  }

  if (isPayoutModeB(String(row.專案類型 ?? ""))) {
    if (fieldMatchesUser(row.經紀人, userName, userEmail)) return true;
    const p = partnerByKolName.get(String(row.KOL名稱 ?? "").trim());
    if (p) {
      for (const key of ["主管", "KOL開發者"] as const) {
        if (fieldMatchesUser(p[key], userName, userEmail)) return true;
      }
    }
  } else {
    for (const key of ["專案BDPM", "專案管理員", "執行管理員"] as const) {
      const cell = row[key as keyof MasterRow] as string | null | undefined;
      if (fieldMatchesUser(cell, userName, userEmail)) return true;
    }
  }

  for (const key of MASTER_RELATED_FIELD_KEYS) {
    const cell = row[key as keyof MasterRow] as string | null | undefined;
    if (fieldMatchesUser(cell, userName, userEmail)) return true;
  }
  const pid = String(row.專案ID ?? "").trim();
  return Boolean(pid && projectIdsFromMyTasks.has(pid));
}

/** 依財務列衍生：待結帳／待分潤／已分潤（無財務列時顯示 —） */
function financeProgressShortLabel(f: FinanceRow | undefined): string {
  if (!f) return "—";
  const v = String(f.廠商付款日期 ?? "").trim();
  const e = String(f.員工分潤日期 ?? "").trim();
  if (!v) return "待結帳";
  if (!e) return "待分潤";
  return "已分潤";
}

function financeProgressDetail(f: FinanceRow | undefined): string {
  if (!f) return "尚無財務列或無法對應專案";
  const v = String(f.廠商付款日期 ?? "").trim();
  const e = String(f.員工分潤日期 ?? "").trim();
  if (!v) return "財務尚未填廠商付款日期（視同廠商未付款）";
  if (!e) return "廠商已付款；財務尚未填員工分潤日期（公司未匯出分潤）";
  return `廠商付款日：${v}；員工分潤日：${e}`;
}

function financeProgressBadgeClass(short: string): string {
  if (short === "待結帳") return "bg-stone-200 text-stone-700";
  if (short === "待分潤") return "bg-amber-100 text-amber-900 ring-1 ring-amber-300/60";
  if (short === "已分潤") return "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300/50";
  return "bg-stone-100 text-stone-500";
}

/** 分潤表三態：對應列上「廠商付款日期」（廠商已付）與「分潤匯款日期」（公司已匯） */
type PayoutWorkflowTabKey = "pending_vendor" | "pending_payout" | "settled";

function payoutRowWorkflowStage(row: PayoutRow): PayoutWorkflowTabKey {
  const vendorIn = String(row.廠商付款日期 ?? "").trim();
  const empOut = String(row.分潤匯款日期 ?? "").trim();
  if (empOut) return "settled";
  if (vendorIn) return "pending_payout";
  return "pending_vendor";
}

/** 大總表儲存格：模式 B 經紀人為大總表手填；主管／KOL開發者由合作夥伴依 KOL 名稱帶出；模式 A 不顯示該三欄（回傳空字串） */
function masterTableCellText(
  row: MasterRow,
  colKey: string,
  partnerByKolName: Map<string, PartnerRow>,
  financeByProjectId?: Map<string, FinanceRow>,
  invoiceSummaryByProjectId?: Map<string, InvoiceSummary>
): string {
  const pid = String(row.專案ID ?? "").trim();
  if (colKey === "款項進度") {
    return financeProgressShortLabel(pid ? financeByProjectId?.get(pid) : undefined);
  }
  if (colKey === "發票摘要") {
    return invoiceSummarySearchText(pid ? invoiceSummaryByProjectId?.get(pid) : undefined);
  }
  const modeB = isPayoutModeB(String(row.專案類型 ?? ""));
  if (colKey === "經紀人") {
    if (!modeB) return "";
    return String(row.經紀人 ?? "").trim();
  }
  if (colKey === "主管" || colKey === "KOL開發者") {
    if (!modeB) return "";
    const p = partnerByKolName.get(String(row.KOL名稱 ?? "").trim());
    return String(p?.[colKey as keyof PartnerRow] ?? "").trim();
  }
  if (colKey === "專案BDPM" || colKey === "專案管理員" || colKey === "執行管理員") {
    if (modeB) return "";
    return String((row as unknown as Record<string, unknown>)[colKey] ?? "").trim();
  }
  if (colKey === "專案引薦人") {
    if (modeB) return "";
    return String(row.專案引薦人 ?? "").trim();
  }
  if (colKey === "專案開發人") {
    if (!modeB) return "";
    return String(row.專案開發人 ?? "").trim();
  }
  return String((row as unknown as Record<string, unknown>)[colKey] ?? "").trim();
}

/** 大總表：分潤模式 A 專用欄（與模式 B 互斥顯示於同表時） */
const MASTER_PAYOUT_MODE_A_COL_KEYS = new Set(["專案BDPM", "專案管理員", "執行管理員"]);
/** 大總表：分潤模式 B 專用欄 */
const MASTER_PAYOUT_MODE_B_COL_KEYS = new Set(["經紀人", "主管", "KOL開發者"]);
/** 模式 A 專用：專案引薦人（製作／活動） */
const MASTER_PAYOUT_MODE_A_ONLY_COL_KEYS = new Set(["專案引薦人"]);
/** 模式 B 專用：專案開發人（廣告業配） */
const MASTER_PAYOUT_MODE_B_ONLY_COL_KEYS = new Set(["專案開發人"]);

/** 系統設定「分潤成數預設」：模式 B 輸入框顯示標籤（JSON key 仍為 master_payout_defaults 既有鍵名） */
const MASTER_PAYOUT_MODE_B_CONFIG_LABELS: Partial<Record<string, string>> = {
  專案開發人分潤成數: "專案開發人",
  KOL開發者分潤成數: "KOL開發者",
};

/** 進行中：排除明顯已結案／完成狀態（空狀態視為進行中） */
function isProjectInProgress(專案狀態: string | null | undefined): boolean {
  const s = String(專案狀態 ?? "").trim();
  if (!s) return true;
  const lower = s.toLowerCase();
  if (lower.includes("結案") || lower.includes("完結") || lower === "完成" || lower.includes("已結束")) return false;
  return true;
}

/** 將 DB／試算表等來源的日期字串轉成 HTML date input 可用的 yyyy-MM-dd */
function normalizeDateForInput(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const slash = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})/.exec(s);
  if (slash) {
    const y = slash[1];
    const m = slash[2].padStart(2, "0");
    const d = slash[3].padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const t = Date.parse(s);
  if (!Number.isNaN(t)) {
    const d = new Date(t);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  return "";
}

function taskAssigneeIsUser(t: TaskRow, userName: string, userEmail: string): boolean {
  const a = String(t.任務負責人 ?? "").trim();
  if (!a) return false;
  return a === userName || a === userEmail;
}

type MasterTaskTemplate = {
  id: number;
  專案ID: string;
  任務名稱: string;
  任務類型?: string | null;
  負責人?: string | null;
  備註?: string | null;
  每月幾號: number;
  提前天數: number;
  啟用: boolean;
  最後觸發鍵?: string | null;
};

type MasterTaskTemplateDraft = {
  任務名稱: string;
  負責人: string;
  備註: string;
  每月幾號: string;
  提前天數: string;
  啟用: boolean;
};

function computeNextTemplateTriggerDateText(dayOfMonth: number, leadDays: number): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const buildTrigger = (year: number, month0: number) => {
    const dueDay = Math.min(Math.max(1, dayOfMonth), new Date(year, month0 + 1, 0).getDate());
    const dueDate = new Date(year, month0, dueDay);
    const trigger = new Date(dueDate);
    trigger.setDate(trigger.getDate() - Math.max(0, leadDays));
    return trigger;
  };
  let next = buildTrigger(y, m);
  const today = new Date(y, m, now.getDate());
  if (next < today) next = buildTrigger(y, m + 1);
  return next.toLocaleDateString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit" });
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
    長期案: false,
    狀態確認日期: "",
    開案日期: "",
    廠商預計付款日: "",
    專案總金額未稅: "",
    專案營收: "",
    專案成本: "",
    KOL費用未稅: "",
    KOL名稱: "",
    經紀人: "",
    專案費用類型: "",
    廠商名稱: "",
    專案資料夾: "",
    專案BDPM: "",
    專案BDPM分潤成數: "",
    專案引薦人: "",
    專案引薦人分潤成數: "",
    專案開發人: "",
    專案開發人分潤成數: "",
    專案管理員: "",
    專案管理員分潤成數: "",
    執行管理員: "",
    執行管理員分潤成數: "",
    專案內容: "",
    備註: "",
  });
  const [selectedMaster, setSelectedMaster] = useState<MasterRow | null>(null);
  const [isEditingMaster, setIsEditingMaster] = useState(false);
  const [showDeleteMasterConfirm, setShowDeleteMasterConfirm] = useState(false);
  const [deletingMaster, setDeletingMaster] = useState(false);
  const [savingMaster, setSavingMaster] = useState(false);
  const [saveMasterError, setSaveMasterError] = useState<string | null>(null);
  const [masterTaskTemplates, setMasterTaskTemplates] = useState<MasterTaskTemplate[]>([]);
  const [masterTaskTemplatesLoading, setMasterTaskTemplatesLoading] = useState(false);
  const [masterTaskTemplatesSaving, setMasterTaskTemplatesSaving] = useState(false);
  const [masterTaskTemplatesError, setMasterTaskTemplatesError] = useState<string | null>(null);
  const [deletingMasterTaskTemplateId, setDeletingMasterTaskTemplateId] = useState<number | null>(null);
  const [pendingDeleteMasterTaskTemplate, setPendingDeleteMasterTaskTemplate] = useState<MasterTaskTemplate | null>(null);
  const [masterTaskTemplateDrafts, setMasterTaskTemplateDrafts] = useState<Record<number, MasterTaskTemplateDraft>>({});
  const [showCreateMasterTaskTemplateForm, setShowCreateMasterTaskTemplateForm] = useState(false);
  const [editingMasterTaskTemplateId, setEditingMasterTaskTemplateId] = useState<number | null>(null);
  const [newMasterTaskTemplateForm, setNewMasterTaskTemplateForm] = useState({
    任務名稱: "",
    負責人: "",
    備註: "",
    每月幾號: "1",
    提前天數: "0",
  });
  const [inlineStatusSavingId, setInlineStatusSavingId] = useState<string | null>(null);
  const [inlineStatusError, setInlineStatusError] = useState<string | null>(null);
  const [editMasterForm, setEditMasterForm] = useState(() => ({
    專案名稱: "",
    專案類型: "",
    專案狀態: "",
    長期案: false,
    狀態確認日期: "",
    開案日期: "",
    廠商預計付款日: "",
    專案資料夾: "",
    專案總金額未稅: "",
    專案營收: "",
    專案成本: "",
    KOL費用未稅: "",
    專案費用類型: "",
    KOL名稱: "",
    經紀人: "",
    廠商名稱: "",
    專案BDPM: "",
    專案BDPM分潤成數: "",
    專案引薦人: "",
    專案引薦人分潤成數: "",
    專案開發人: "",
    專案開發人分潤成數: "",
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
  const [newTaskForm, setNewTaskForm] = useState({ 任務名稱: "", 任務類型: "", 任務負責人: "", 到期日: "", 備註: "" });
  const [addingTask, setAddingTask] = useState(false);
  const [addTaskError, setAddTaskError] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<TaskRow | null>(null);
  const [editTaskForm, setEditTaskForm] = useState({ 任務名稱: "", 任務類型: "", 任務負責人: "", 到期日: "", 任務完成: false, 備註: "" });
  const [savingTask, setSavingTask] = useState(false);
  const [saveTaskError, setSaveTaskError] = useState<string | null>(null);
  const [remindingTaskId, setRemindingTaskId] = useState<string | null>(null);
  const [tasksSectionViewMode, setTasksSectionViewMode] = useState<"list" | "byAssignee">("list");
  const [workloadDrill, setWorkloadDrill] = useState<{ assigneeLabel: string; kind: WorkloadDrillKind } | null>(null);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [changePasswordForm, setChangePasswordForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [changingPassword, setChangingPassword] = useState(false);
  const [changePasswordError, setChangePasswordError] = useState<string | null>(null);
  const [changePasswordMessage, setChangePasswordMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedUserForVisibility, setSelectedUserForVisibility] = useState<User | null>(null);
  const [visibilityTables, setVisibilityTables] = useState<string[]>([]);
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
    KOL開發者: string;
    經銷約開始日: string;
    自來件分潤: string;
    "SDH開發分件分潤": string;
    經銷約結束日: string;
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
    KOL開發者: "",
    經銷約開始日: "",
    自來件分潤: "",
    "SDH開發分件分潤": "",
    經銷約結束日: "",
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
    KOL開發者: string;
    經銷約開始日: string;
    自來件分潤: string;
    "SDH開發分件分潤": string;
    經銷約結束日: string;
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
    KOL開發者: "",
    經銷約開始日: "",
    自來件分潤: "",
    "SDH開發分件分潤": "",
    經銷約結束日: "",
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
  /** 編輯 Modal 開啟時的來源列（判斷可否儲存） */
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
    project_status_options?: string[];
    project_expense_type_options?: string[];
    task_type_options?: string[];
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
  const [invoiceEditSavingId, setInvoiceEditSavingId] = useState<string | null>(null);
  const [invoiceEditError, setInvoiceEditError] = useState<string | null>(null);
  const [invoiceMonthTab, setInvoiceMonthTab] = useState("all");
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<string[]>([]);
  const [deletingInvoiceIds, setDeletingInvoiceIds] = useState<string[]>([]);
  const invoicesRef = useRef<InvoiceRow[]>([]);
  const invoiceSaveInflightRef = useRef<Set<string>>(new Set());
  const invoiceSavePendingRef = useRef<Set<string>>(new Set());
  const [paymentRecords, setPaymentRecords] = useState<PaymentRecordRow[]>([]);
  const [paymentEditSavingId, setPaymentEditSavingId] = useState<string | null>(null);
  const [paymentEditError, setPaymentEditError] = useState<string | null>(null);
  const paymentRecordsRef = useRef<PaymentRecordRow[]>([]);
  const paymentSaveInflightRef = useRef<Set<string>>(new Set());
  const paymentSavePendingRef = useRef<Set<string>>(new Set());
  const [finance, setFinance] = useState<FinanceRow[]>([]);
  const [financeEditSaving專案ID, setFinanceEditSaving專案ID] = useState<string | null>(null);
  const [financeEditError, setFinanceEditError] = useState<string | null>(null);
  const financeRef = useRef<FinanceRow[]>([]);
  const financeSaveInflightRef = useRef<Set<string>>(new Set());
  const financeSavePendingRef = useRef<Set<string>>(new Set());
  const [payoutList, setPayoutList] = useState<PayoutRow[]>([]);
  /** Dashboard 分頁搜尋關鍵字（各區塊獨立） */
  const [masterSearch, setMasterSearch] = useState("");
  /** 大總表：依專案類型子分頁（「全部」= 不篩類型） */
  const [masterSubTab, setMasterSubTab] = useState("全部");
  /** 大總表：進行中 / 已結案（生命週期） */
  const [masterLifecycleTab, setMasterLifecycleTab] = useState<"in_progress" | "closed">(() => {
    if (typeof window === "undefined") return "in_progress";
    try {
      const v = localStorage.getItem("sdh-master-lifecycle-tab");
      if (v === "closed" || v === "in_progress") return v;
    } catch {
      /* ignore */
    }
    return "in_progress";
  });
  /** 大總表：專案屬性篩選（長期案） */
  const [masterLongTermFilter, setMasterLongTermFilter] = useState<"all" | "long_term_only">(() => {
    if (typeof window === "undefined") return "all";
    try {
      const v = localStorage.getItem("sdh-master-long-term-filter");
      if (v === "all" || v === "long_term_only") return v;
    } catch {
      /* ignore */
    }
    return "all";
  });
  const [masterCreatedSortDirection, setMasterCreatedSortDirection] = useState<MasterCreatedSortDirection>(() => {
    if (typeof window === "undefined") return "desc";
    try {
      const v = localStorage.getItem("sdh-master-created-sort-direction");
      if (v === "asc" || v === "desc") return v;
    } catch {
      /* ignore */
    }
    return "desc";
  });
  /** 行動版：側欄抽屜；桌面：側欄收合為窄欄 */
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [partnersSearch, setPartnersSearch] = useState("");
  const [tasksSearch, setTasksSearch] = useState("");
  const [payoutSearch, setPayoutSearch] = useState("");
  const [payoutWorkflowTab, setPayoutWorkflowTab] = useState<PayoutWorkflowTabKey>("pending_vendor");
  const [financeSearch, setFinanceSearch] = useState("");
  const [invoicesSearch, setInvoicesSearch] = useState("");
  const [paymentRecordsSearch, setPaymentRecordsSearch] = useState("");
  const [tasksLifecycleTab, setTasksLifecycleTab] = useState<"in_progress" | "completed">(() => {
    if (typeof window === "undefined") return "in_progress";
    try {
      const v = localStorage.getItem("sdh-tasks-lifecycle-tab");
      if (v === "in_progress" || v === "completed") return v;
    } catch {
      /* ignore */
    }
    return "in_progress";
  });
  /** 財務分頁內：依專案列 vs 發票清冊 vs 付款記錄 */
  const [financeSubTab, setFinanceSubTab] = useState<"byProject" | "invoices" | "payments">("byProject");
  const [showInvoiceCreateModal, setShowInvoiceCreateModal] = useState(false);
  const [showInvoicePasteImportModal, setShowInvoicePasteImportModal] = useState(false);
  const [invoicePasteText, setInvoicePasteText] = useState("");
  const [invoiceDraftRows, setInvoiceDraftRows] = useState<Array<Record<string, string>>>([]);
  const [savingInvoices, setSavingInvoices] = useState(false);
  const [invoiceCreateError, setInvoiceCreateError] = useState<string | null>(null);
  const [showPaymentCreateModal, setShowPaymentCreateModal] = useState(false);
  const [paymentDraftRows, setPaymentDraftRows] = useState<Array<Record<string, string>>>([]);
  const [savingPayments, setSavingPayments] = useState(false);
  const [paymentCreateError, setPaymentCreateError] = useState<string | null>(null);
  /** 連號精靈：前綴、起始數字、筆數、數字補零位數（空＝不補） */
  const [invoiceSeqPrefix, setInvoiceSeqPrefix] = useState("");
  const [invoiceSeqStart, setInvoiceSeqStart] = useState("1");
  const [invoiceSeqCount, setInvoiceSeqCount] = useState("3");
  const [invoiceSeqPad, setInvoiceSeqPad] = useState("");
  /** 大資料量時分段渲染，降低首屏與互動卡頓 */
  const [masterRenderCount, setMasterRenderCount] = useState(RENDER_CHUNK_SIZE);
  const [partnersRenderCount, setPartnersRenderCount] = useState(RENDER_CHUNK_SIZE);
  const [payoutRenderCount, setPayoutRenderCount] = useState(RENDER_CHUNK_SIZE);
  const [tasksRenderCount, setTasksRenderCount] = useState(RENDER_CHUNK_SIZE);
  const [financeRenderCount, setFinanceRenderCount] = useState(RENDER_CHUNK_SIZE);
  const [invoicesRenderCount, setInvoicesRenderCount] = useState(RENDER_CHUNK_SIZE);
  const [paymentRecordsRenderCount, setPaymentRecordsRenderCount] = useState(RENDER_CHUNK_SIZE);
  /** 讓輸入先回應，再延後套用篩選，降低卡頓 */
  const deferredMasterSearch = useDeferredValue(masterSearch);
  const deferredPartnersSearch = useDeferredValue(partnersSearch);
  const deferredTasksSearch = useDeferredValue(tasksSearch);
  const deferredPayoutSearch = useDeferredValue(payoutSearch);
  const deferredFinanceSearch = useDeferredValue(financeSearch);
  const deferredInvoicesSearch = useDeferredValue(invoicesSearch);
  const deferredPaymentRecordsSearch = useDeferredValue(paymentRecordsSearch);

  const payoutDefaults = useMemo(
    () => systemConfig?.master_payout_defaults ?? MASTER_PAYOUT_DEFAULTS,
    [systemConfig]
  );
  const projectTypesOptions = useMemo(
    () => systemConfig?.project_types ?? [...PROJECT_TYPES],
    [systemConfig]
  );
  /** 大總表子分頁選項：全部 + 系統設定之專案類型 */
  const masterSubTabOptions = useMemo(() => ["全部", ...projectTypesOptions] as const, [projectTypesOptions]);
  const projectStatusOptions = useMemo(
    () => systemConfig?.project_status_options ?? [...DEFAULT_PROJECT_STATUS_OPTIONS],
    [systemConfig]
  );
  const taskTypeOptions = useMemo(
    () => systemConfig?.task_type_options ?? [...DEFAULT_TASK_TYPE_OPTIONS],
    [systemConfig]
  );
  const projectExpenseTypeOptions = useMemo(
    () => systemConfig?.project_expense_type_options ?? [...DEFAULT_PROJECT_EXPENSE_TYPE_OPTIONS],
    [systemConfig]
  );
  /** 合作夥伴（已核准）的「合作夥伴名稱」＝大總表 KOL 名稱選項 */
  const kolNameOptionsFromDb = useMemo(() => {
    const names = partners.map((p) => String(p.合作夥伴名稱 ?? "").trim()).filter(Boolean);
    return [...new Set(names)].sort((a, b) => a.localeCompare(b, "zh-Hant"));
  }, [partners]);
  /** 財務單據：用專案名稱搜尋，選到後仍寫入專案ID */
  const invoiceProjectOptions = useMemo<InvoiceProjectOption[]>(() => {
    const byId = new Map<string, InvoiceProjectOption>();
    for (const m of masterList) {
      const id = String(m.專案ID ?? "").trim();
      if (!id || byId.has(id)) continue;
      const name = String(m.專案名稱 ?? "").trim();
      byId.set(id, {
        id,
        name,
        searchText: `${name} ${id}`.trim(),
      });
    }
    return [...byId.values()].sort((a, b) => {
      const byName = invoiceProjectDisplayName(a, a.id).localeCompare(invoiceProjectDisplayName(b, b.id), "zh-TW");
      return byName || a.id.localeCompare(b.id, "zh-TW");
    });
  }, [masterList]);
  const invoicePasteImport = useMemo(() => parseInvoiceImportText(invoicePasteText), [invoicePasteText]);
  /** 刪除專案確認視窗：連動筆數（任務、分潤列） */
  const masterDeleteRelatedCounts = useMemo(() => {
    if (!selectedMaster) return { tasks: 0, payouts: 0 };
    const pid = String(selectedMaster.專案ID ?? "").trim();
    const tasksN = tasks.filter((t) => String(t.專案ID ?? "").trim() === pid).length;
    const payoutsN = payoutList.filter((p) => String(p.專案ID ?? "").trim() === pid).length;
    return { tasks: tasksN, payouts: payoutsN };
  }, [selectedMaster, tasks, payoutList]);
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

  /** 角色列表：優先使用系統設定（DB），無則用 config 預設；一律附帶 KOL（訪客入口），避免舊 DB 未列而選不到 */
  const displayRoles = useMemo(() => {
    const base = systemConfig?.roles?.length ? systemConfig.roles : [...ROLES];
    return base.includes("KOL") ? base : [...base, "KOL"];
  }, [systemConfig?.roles]);

  const kolPartnerScopeOptions = useMemo(() => kolPartnerSelectOptions(partners), [partners]);

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

  /** 使用者姓名列表（對應 DB Users：姓名優先，無則帳號 email；新增／刪除使用者後會隨 refreshDashboardData(['users']) 更新） */
  const userNames = useMemo(
    () => [...new Set(users.map((u) => (u.name && u.name.trim()) || u.email || "").filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-TW")),
    [users]
  );

  /** 董事長／管理者可為使用者設定可見範圍、調整系統設定 */
  const canEditVisibility = me && ["董事長", "管理者"].includes(me.role);
  const canUpdateMaster = useMemo(
    () => Boolean(me?.role && rolePermissions.master.update.includes(me.role)),
    [me?.role, rolePermissions]
  );

  const loadMasterTaskTemplates = useCallback(async (projectId: string) => {
    const pid = String(projectId ?? "").trim();
    if (!pid) return;
    setMasterTaskTemplatesLoading(true);
    setMasterTaskTemplatesError(null);
    try {
      const res = await fetch(`/api/master/task-templates?projectId=${encodeURIComponent(pid)}`, { cache: "no-store" });
      const data = (await safeResJson(res)) as {
        ok?: boolean;
        error?: string;
        templates?: MasterTaskTemplate[];
      };
      if (!res.ok || !data.ok) {
        setMasterTaskTemplatesError(data.error ?? "讀取排程模板失敗");
        return;
      }
      setMasterTaskTemplates(Array.isArray(data.templates) ? data.templates : []);
    } catch (e) {
      setMasterTaskTemplatesError(e instanceof Error ? e.message : "讀取排程模板失敗");
    } finally {
      setMasterTaskTemplatesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedMaster?.專案ID || !selectedMaster.長期案) {
      setMasterTaskTemplates([]);
      setMasterTaskTemplateDrafts({});
      setMasterTaskTemplatesError(null);
      return;
    }
    void loadMasterTaskTemplates(selectedMaster.專案ID);
  }, [selectedMaster?.專案ID, selectedMaster?.長期案, loadMasterTaskTemplates]);

  useEffect(() => {
    const nextDrafts: Record<number, MasterTaskTemplateDraft> = {};
    for (const tpl of masterTaskTemplates) {
      nextDrafts[tpl.id] = {
        任務名稱: String(tpl.任務名稱 ?? ""),
        負責人: String(tpl.負責人 ?? ""),
        備註: String(tpl.備註 ?? ""),
        每月幾號: String(tpl.每月幾號 ?? 1),
        提前天數: String(tpl.提前天數 ?? 0),
        啟用: Boolean(tpl.啟用),
      };
    }
    setMasterTaskTemplateDrafts(nextDrafts);
  }, [masterTaskTemplates]);

  const createMasterTaskTemplateRow = useCallback(async () => {
    const pid = String(selectedMaster?.專案ID ?? "").trim();
    if (!pid) return;
    setMasterTaskTemplatesSaving(true);
    setMasterTaskTemplatesError(null);
    try {
      const res = await fetch("/api/master/task-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          專案ID: pid,
          任務名稱: newMasterTaskTemplateForm.任務名稱,
          負責人: newMasterTaskTemplateForm.負責人 || null,
          備註: newMasterTaskTemplateForm.備註 || null,
          每月幾號: Number(newMasterTaskTemplateForm.每月幾號),
          提前天數: Number(newMasterTaskTemplateForm.提前天數),
          啟用: true,
        }),
      });
      const data = (await safeResJson(res)) as { ok?: boolean; error?: string; template?: MasterTaskTemplate };
      if (!res.ok || !data.ok || !data.template) {
        setMasterTaskTemplatesError(data.error ?? "新增排程模板失敗");
        return;
      }
      setMasterTaskTemplates((prev) => [data.template as MasterTaskTemplate, ...prev]);
      setNewMasterTaskTemplateForm({ 任務名稱: "", 負責人: "", 備註: "", 每月幾號: "1", 提前天數: "0" });
      setShowCreateMasterTaskTemplateForm(false);
    } catch (e) {
      setMasterTaskTemplatesError(e instanceof Error ? e.message : "新增排程模板失敗");
    } finally {
      setMasterTaskTemplatesSaving(false);
    }
  }, [newMasterTaskTemplateForm, selectedMaster?.專案ID]);

  const toggleMasterTaskTemplateEnabled = useCallback(async (tpl: MasterTaskTemplate) => {
    setMasterTaskTemplatesError(null);
    try {
      const res = await fetch("/api/master/task-templates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ id: tpl.id, 啟用: !tpl.啟用 }),
      });
      const data = (await safeResJson(res)) as { ok?: boolean; error?: string; template?: MasterTaskTemplate };
      if (!res.ok || !data.ok || !data.template) {
        setMasterTaskTemplatesError(data.error ?? "更新模板失敗");
        return;
      }
      setMasterTaskTemplates((prev) => prev.map((r) => (r.id === tpl.id ? (data.template as MasterTaskTemplate) : r)));
    } catch (e) {
      setMasterTaskTemplatesError(e instanceof Error ? e.message : "更新模板失敗");
    }
  }, []);

  const deleteMasterTaskTemplateRow = useCallback(async (id: number) => {
    setMasterTaskTemplatesError(null);
    setDeletingMasterTaskTemplateId(id);
    try {
      const res = await fetch("/api/master/task-templates", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ id }),
      });
      const data = (await safeResJson(res)) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setMasterTaskTemplatesError(data.error ?? "刪除模板失敗");
        return;
      }
      setMasterTaskTemplates((prev) => prev.filter((r) => r.id !== id));
      setPendingDeleteMasterTaskTemplate(null);
    } catch (e) {
      setMasterTaskTemplatesError(e instanceof Error ? e.message : "刪除模板失敗");
    } finally {
      setDeletingMasterTaskTemplateId(null);
    }
  }, []);

  const saveMasterTaskTemplateRow = useCallback(async (id: number) => {
    const draft = masterTaskTemplateDrafts[id];
    if (!draft) return;
    setMasterTaskTemplatesSaving(true);
    setMasterTaskTemplatesError(null);
    try {
      const res = await fetch("/api/master/task-templates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          id,
          任務名稱: draft.任務名稱,
          負責人: draft.負責人 || null,
          備註: draft.備註 || null,
          每月幾號: Number(draft.每月幾號),
          提前天數: Number(draft.提前天數),
          啟用: draft.啟用,
        }),
      });
      const data = (await safeResJson(res)) as { ok?: boolean; error?: string; template?: MasterTaskTemplate };
      if (!res.ok || !data.ok || !data.template) {
        setMasterTaskTemplatesError(data.error ?? "儲存模板失敗");
        return;
      }
      setMasterTaskTemplates((prev) => prev.map((r) => (r.id === id ? (data.template as MasterTaskTemplate) : r)));
      setEditingMasterTaskTemplateId(null);
    } catch (e) {
      setMasterTaskTemplatesError(e instanceof Error ? e.message : "儲存模板失敗");
    } finally {
      setMasterTaskTemplatesSaving(false);
    }
  }, [masterTaskTemplateDrafts]);

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
      /** ③ 自訂：是否顯示「總覽」分頁由 tables 是否含 overview 決定 */
      base = [...myVisibility.tables];
    } else {
      const fromDb = systemConfig?.role_visibility?.[me.role]?.sections;
      base = fromDb && fromDb.length > 0 ? [...fromDb] : [...defaultSecs];
      /** ① 不再勾選總覽區塊，儲存時仍會帶入 overview；舊 DB 若無則補上 */
      if (!base.includes("overview")) base = ["overview", ...base];
    }
    /** 舊設定「發票」獨立區塊 → 整併為「財務」 */
    const merged = base.map((s) => (s === "invoices" ? "finance" : s));
    return [...new Set(merged)];
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
    let merged = [...ordered, ...rest];
    merged = merged.filter((k) => k !== "invoices");
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
      if (prev === "invoices") return "finance";
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
      if (tableKey === "overview") {
        const cols = myVisibility?.columns?.overview;
        const allKeys = (TABLE_COLUMNS.overview ?? []).map((c) => c.key);
        if (!cols || cols.length === 0) return allKeys;
        if (cols.includes("*")) return allKeys;
        return cols.filter((k) => allKeys.includes(k));
      }
      const cols = myVisibility?.columns?.[tableKey];
      let normalized: string[] | undefined =
        tableKey === "tasks" && cols && !cols.includes("*")
          ? cols.map((c) => (c === "狀態" ? "任務類型" : c))
          : cols;
      if (tableKey === "finance" && Array.isArray(normalized) && !normalized.includes("*")) {
        const legacy: Record<string, string> = {
          員工分潤狀態: "員工分潤日期",
        };
        normalized = [...new Set(normalized.map((k) => legacy[k] ?? k))];
      }
      const allKeys = (TABLE_COLUMNS[tableKey] ?? []).map((c) => c.key);
      if (!normalized || normalized.includes("*")) {
        if (tableKey === "master") return allKeys.filter((k) => k !== "款項進度");
        return allKeys;
      }
      /** 任務表：系統時間欄位併入可見清單（舊 ③ 設定未勾選時仍顯示） */
      if (tableKey === "tasks") {
        const merged = [...normalized];
        for (const sys of ["建立者", "開始時間", "完成時間"] as const) {
          if (allKeys.includes(sys) && !merged.includes(sys)) merged.push(sys);
        }
        return merged.filter((k) => allKeys.includes(k));
      }
      /** 財務：新欄「專案名稱」緊接在 專案ID 後（舊 ③ 設定未勾選時仍顯示） */
      if (tableKey === "finance") {
        const merged = [...normalized];
        if (allKeys.includes("專案名稱") && !merged.includes("專案名稱")) {
          const idx = merged.indexOf("專案ID");
          if (idx !== -1) merged.splice(idx + 1, 0, "專案名稱");
          else merged.unshift("專案名稱");
        }
        return merged.filter((k) => allKeys.includes(k));
      }
      /** 大總表：主表只自動補發票摘要；款項進度移到展開細節中顯示 */
      if (tableKey === "master") {
        const merged = [...normalized];
        if (merged.includes("專案引薦人") && !merged.includes("專案開發人") && allKeys.includes("專案開發人")) {
          const idx = merged.indexOf("專案引薦人");
          merged.splice(idx + 1, 0, "專案開發人");
        }
        if (allKeys.includes("發票摘要") && !merged.includes("發票摘要")) {
          const idx = merged.indexOf("專案狀態");
          if (idx !== -1) merged.splice(idx + 1, 0, "發票摘要");
          else merged.push("發票摘要");
        }
        return merged.filter((k) => allKeys.includes(k) && k !== "款項進度");
      }
      return normalized;
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

  /** 合作夥伴「合作夥伴名稱」→ 列（大總表模式 B：主管／KOL開發者依 KOL 名稱對應；經紀人為專案欄位） */
  const partnerByKolName = useMemo(() => {
    const m = new Map<string, PartnerRow>();
    for (const p of partners) {
      const name = String(p.合作夥伴名稱 ?? "").trim();
      if (name) m.set(name, p);
    }
    return m;
  }, [partners]);
  const createMasterSelectedPartner = useMemo(
    () => partnerByKolName.get(String(createForm.KOL名稱 ?? "").trim()),
    [partnerByKolName, createForm.KOL名稱]
  );
  const selectedMasterPartner = useMemo(() => {
    const kolName = isEditingMaster ? editMasterForm.KOL名稱 : selectedMaster?.KOL名稱;
    return partnerByKolName.get(String(kolName ?? "").trim());
  }, [partnerByKolName, isEditingMaster, editMasterForm.KOL名稱, selectedMaster?.KOL名稱]);

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
          let val = String((row as unknown as Record<string, unknown>)[key] ?? "").trim();
          if (!val && tableKey === "master" && (key === "主管" || key === "KOL開發者")) {
            const r = row as unknown as MasterRow;
            const p = partnerByKolName.get(String(r.KOL名稱 ?? "").trim());
            val = String((p as Record<string, unknown> | undefined)?.[key] ?? "").trim();
          }
          if (!val) continue;
          if (val === uName || val === uEmail) return true;
        }
        return false;
      });
    },
    [me, visibilityRules, partnerByKolName]
  );

  const masterListByCreatedAt = useMemo(
    () => sortMasterRowsByCreatedAt(masterList, masterCreatedSortDirection),
    [masterList, masterCreatedSortDirection]
  );

  const filteredMasterList = useMemo(
    () => filterRowsByVisibility(masterListByCreatedAt as unknown as Record<string, unknown>[], "master") as unknown as MasterRow[],
    [masterListByCreatedAt, filterRowsByVisibility]
  );

  /** 大總表頂部「進行中／已結案」數量（② 可見範圍內） */
  const masterLifecycleCounts = useMemo(() => {
    let active = 0;
    let closed = 0;
    for (const row of filteredMasterList) {
      if (!isProjectInProgress(row.專案狀態)) {
        closed += 1;
      } else {
        active += 1;
      }
    }
    return { active, closed };
  }, [filteredMasterList]);

  /** 大總表：先依「進行中／已結案」篩選 */
  const masterLifecycleBaseList = useMemo(() => {
    if (masterLifecycleTab === "in_progress") {
      return filteredMasterList.filter((row) => isProjectInProgress(row.專案狀態));
    }
    return filteredMasterList.filter((row) => !isProjectInProgress(row.專案狀態));
  }, [filteredMasterList, masterLifecycleTab]);

  /** 大總表：生命週期內再依「全部／僅長期案」篩選 */
  const masterLongTermFilteredList = useMemo(() => {
    if (masterLongTermFilter === "all") return masterLifecycleBaseList;
    return masterLifecycleBaseList.filter((row) => Boolean(row.長期案));
  }, [masterLifecycleBaseList, masterLongTermFilter]);

  const masterLongTermCounts = useMemo(() => {
    const all = masterLifecycleBaseList.length;
    const longTermOnly = masterLifecycleBaseList.filter((row) => Boolean(row.長期案)).length;
    return { all, longTermOnly };
  }, [masterLifecycleBaseList]);

  /** 大總表：再依子分頁「專案類型」篩選後的列表（再套用關鍵字搜尋） */
  const masterTabFilteredList = useMemo(() => {
    if (masterSubTab === "全部") return masterLongTermFilteredList;
    return masterLongTermFilteredList.filter((row) => String(row.專案類型 ?? "").trim() === masterSubTab);
  }, [masterLongTermFilteredList, masterSubTab]);

  /** 合作夥伴 / KOL：與其他表相同，依 ② match_fields 篩列（未勾選 = 不篩；勾選欄位 = 該欄等於登入者姓名或帳號） */
  const filteredPartners = useMemo(
    () => filterRowsByVisibility(partners as unknown as Record<string, unknown>[], "partners") as unknown as PartnerRow[],
    [partners, filterRowsByVisibility]
  );
  const filteredTasks = useMemo(
    () => filterRowsByVisibility(tasks as unknown as Record<string, unknown>[], "tasks") as unknown as TaskRow[],
    [tasks, filterRowsByVisibility]
  );
  const tasksLifecycleCounts = useMemo(() => {
    let inProgress = 0;
    let completed = 0;
    for (const t of filteredTasks) {
      if (t.任務完成) completed += 1;
      else inProgress += 1;
    }
    return { inProgress, completed };
  }, [filteredTasks]);
  const tasksLifecycleFilteredList = useMemo(
    () =>
      filteredTasks.filter((t) =>
        tasksLifecycleTab === "completed" ? Boolean(t.任務完成) : !Boolean(t.任務完成)
      ),
    [filteredTasks, tasksLifecycleTab]
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
      .filter((row) => isMasterRowRelatedToUser(row, uName, uEmail, overviewMyTaskProjectIds, partnerByKolName))
      .slice(0, 100);
  }, [filteredMasterList, me, overviewDirectorCompanyView, overviewMyTaskProjectIds, partnerByKolName]);

  const overviewTaskRows = useMemo(() => {
    if (!me) return [];
    const uName = (me.name ?? "").trim();
    const uEmail = (me.email ?? "").trim();
    const open = filteredTasks.filter((t) => !t.任務完成);
    if (overviewDirectorCompanyView) return open.slice(0, 150);
    return open.filter((t) => taskAssigneeIsUser(t, uName, uEmail)).slice(0, 150);
  }, [filteredTasks, me, overviewDirectorCompanyView]);

  /** 總覽頂部指標：③ columns.overview 優先；舊版 overview_kpis；最後依 system_config／靜態角色預設 */
  const visibleOverviewKpiKeys = useMemo((): OverviewKpiKey[] => {
    if (!me) return [];
    const fromRole =
      systemConfig?.overview_kpi_by_role?.[me.role] ?? getDefaultOverviewKpisForRole(me.role);
    const colKeys = myVisibility?.columns?.overview;
    if (colKeys && colKeys.length > 0) {
      if (colKeys.includes("*")) return [...OVERVIEW_KPI_KEYS] as OverviewKpiKey[];
      const filtered = colKeys.filter((k): k is OverviewKpiKey =>
        OVERVIEW_KPI_KEYS.includes(k as OverviewKpiKey)
      );
      return (filtered.length ? filtered : (fromRole as OverviewKpiKey[])) as OverviewKpiKey[];
    }
    const legacy = myVisibility?.overview_kpis;
    if (legacy !== null && legacy !== undefined && legacy.length > 0) {
      return legacy.filter((k): k is OverviewKpiKey => OVERVIEW_KPI_KEYS.includes(k as OverviewKpiKey));
    }
    if (legacy !== null && legacy !== undefined && legacy.length === 0) return [];
    const fromR = fromRole.filter((k) => OVERVIEW_KPI_KEYS.includes(k as OverviewKpiKey));
    return (fromR.length ? fromR : [...OVERVIEW_KPI_KEYS]) as OverviewKpiKey[];
  }, [me, systemConfig?.overview_kpi_by_role, myVisibility?.columns?.overview, myVisibility?.overview_kpis]);

  const masterRowsForOverviewKpis = useMemo(() => {
    if (!me) return [];
    const uName = (me.name ?? "").trim();
    const uEmail = (me.email ?? "").trim();
    if (overviewDirectorCompanyView) return filteredMasterList;
    return filteredMasterList.filter((row) =>
      isMasterRowRelatedToUser(row, uName, uEmail, overviewMyTaskProjectIds, partnerByKolName)
    );
  }, [filteredMasterList, me, overviewDirectorCompanyView, overviewMyTaskProjectIds, partnerByKolName]);

  const overviewKpiMetrics = useMemo(() => {
    if (!me) return null;
    const uName = (me.name ?? "").trim();
    const uEmail = (me.email ?? "").trim();
    const inProgress = (rows: MasterRow[]) => rows.filter((row) => isProjectInProgress(row.專案狀態));
    const projectCount = overviewDirectorCompanyView
      ? inProgress(filteredMasterList).length
      : inProgress(filteredMasterList).filter((row) =>
          isMasterRowRelatedToUser(row, uName, uEmail, overviewMyTaskProjectIds, partnerByKolName)
        ).length;
    const pendingTasks = filteredTasks.filter(
      (t) => !t.任務完成 && taskAssigneeIsUser(t, uName, uEmail)
    ).length;
    let totalUntaxedAmount = 0;
    let totalCost = 0;
    for (const row of masterRowsForOverviewKpis) {
      totalUntaxedAmount += masterRowUntaxedTotal(row);
      totalCost += masterRowCostSum(row);
    }
    const grossMarginPct = totalUntaxedAmount > 0 ? ((totalUntaxedAmount - totalCost) / totalUntaxedAmount) * 100 : null;
    return { projectCount, pendingTasks, totalRevenue: totalUntaxedAmount, totalCost, grossMarginPct };
  }, [me, filteredMasterList, filteredTasks, overviewDirectorCompanyView, overviewMyTaskProjectIds, masterRowsForOverviewKpis, partnerByKolName]);

  const masterVisibleCols = useMemo(() => getVisibleColumnKeys("master"), [getVisibleColumnKeys]);
  const partnersVisibleCols = useMemo(() => getVisibleColumnKeys("partners"), [getVisibleColumnKeys]);
  const tasksVisibleCols = useMemo(() => getVisibleColumnKeys("tasks"), [getVisibleColumnKeys]);
  const filteredPayout = useMemo(
    () => filterRowsByVisibility(payoutList as unknown as Record<string, unknown>[], "payout") as unknown as PayoutRow[],
    [payoutList, filterRowsByVisibility]
  );
  const payoutVisibleCols = useMemo(
    () => normalizePayoutVisibleKeys(getVisibleColumnKeys("payout")),
    [getVisibleColumnKeys]
  );
  /** 分潤表實際欄順序：與權限／可見欄位一致，但全角色統一為「分潤金額優先」 */
  const payoutColsForDisplay = useMemo(() => sortPayoutColumnsForDisplay(payoutVisibleCols), [payoutVisibleCols]);
  /** 待結帳／待分潤不顯示「分潤匯款日期」（有值即已分潤，僅在已分潤分頁有意義） */
  const payoutColsForActiveWorkflowTab = useMemo(() => {
    if (payoutWorkflowTab === "settled") return payoutColsForDisplay;
    return payoutColsForDisplay.filter((k) => k !== "分潤匯款日期");
  }, [payoutColsForDisplay, payoutWorkflowTab]);
  const financeVisibleCols = useMemo(() => getVisibleColumnKeys("finance"), [getVisibleColumnKeys]);
  const invoicesVisibleCols = useMemo(() => getVisibleColumnKeys("invoices"), [getVisibleColumnKeys]);
  const paymentRecordsVisibleCols = useMemo(() => getVisibleColumnKeys("paymentRecords"), [getVisibleColumnKeys]);
  const invoiceMonthTabs = useMemo(() => {
    const counts = new Map<string, number>();
    for (const inv of invoices) {
      const key = invoiceMonthKey(inv);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const months = [...counts.keys()].sort((a, b) => {
      if (a === "未分類") return 1;
      if (b === "未分類") return -1;
      return b.localeCompare(a);
    });
    return [
      { key: "all", label: "全部", count: invoices.length },
      ...months.map((key) => ({ key, label: invoiceMonthLabel(key), count: counts.get(key) ?? 0 })),
    ];
  }, [invoices]);
  const monthFilteredInvoices = useMemo(
    () => (invoiceMonthTab === "all" ? invoices : invoices.filter((inv) => invoiceMonthKey(inv) === invoiceMonthTab)),
    [invoices, invoiceMonthTab]
  );
  const selectedInvoiceIdSet = useMemo(() => new Set(selectedInvoiceIds), [selectedInvoiceIds]);
  const deletingInvoiceIdSet = useMemo(() => new Set(deletingInvoiceIds), [deletingInvoiceIds]);

  const financeByProjectId = useMemo(() => {
    const m = new Map<string, FinanceRow>();
    for (const f of finance) {
      const pid = String(f.專案ID ?? "").trim();
      if (pid) m.set(pid, f);
    }
    return m;
  }, [finance]);

  const invoiceSummaryByProjectId = useMemo(() => {
    const grouped = new Map<string, InvoiceRow[]>();
    for (const invoice of invoices) {
      const pid = String(invoice.專案ID ?? "").trim();
      if (!pid) continue;
      const rows = grouped.get(pid) ?? [];
      rows.push(invoice);
      grouped.set(pid, rows);
    }
    const summaries = new Map<string, InvoiceSummary>();
    for (const [pid, rows] of grouped) {
      summaries.set(pid, buildInvoiceSummary(rows));
    }
    return summaries;
  }, [invoices]);

  const masterByProjectId = useMemo(() => {
    const m = new Map<string, MasterRow>();
    for (const row of masterList) {
      const pid = String(row.專案ID ?? "").trim();
      if (pid) m.set(pid, row);
    }
    return m;
  }, [masterList]);

  /**
   * KOL 區塊主列表欄位（與 ③ 可見欄位交集）
   * ② 篩選：勾選之欄位須與登入者 Users.姓名 或 Users.帳號 完全一致才會留下該列（經紀人改在大總表專案維護，合作夥伴不含此欄）
   */
  const partnerListCols = useMemo(
    () =>
      /** KOL開發者、經銷約開始日不顯示在主列表，僅在新增/編輯 Modal 與展開詳情維護 */
      /** 自來件分潤、SDH分潤、經銷約起迄等詳見列下方展開區 */
      ["合作夥伴名稱", "社群網站", "粉絲數", "頻道｜節目名稱", "資料夾", "分級"].filter((k) =>
        partnersVisibleCols.includes(k)
      ),
    [partnersVisibleCols]
  );

  /** 套用關鍵字搜尋後的各 Table 資料（大總表：先進行中/已結案 → 專案類型 → 搜尋；模式 B 欄由合作夥伴帶出） */
  const searchedMasterList = useMemo(() => {
    const q = deferredMasterSearch.trim().toLowerCase();
    if (!q) return masterTabFilteredList;
    return masterTabFilteredList.filter((row) =>
      masterVisibleCols.some((k) =>
        masterTableCellText(row, k, partnerByKolName, financeByProjectId, invoiceSummaryByProjectId).toLowerCase().includes(q)
      )
    );
  }, [masterTabFilteredList, masterVisibleCols, deferredMasterSearch, partnerByKolName, financeByProjectId, invoiceSummaryByProjectId]);

  /**
   * 依「目前子分頁篩選後」是否同時含模式 A 與模式 B 專案，決定表頭角色欄。
   * 單一專案類型分頁時通常只會出現一組角色欄；「全部」且兩種專案並存時仍顯示兩組。
   */
  const { masterColsForDisplay, masterFilteredListHasBothPayoutModes } = useMemo(() => {
    const cols = masterVisibleCols;
    if (masterTabFilteredList.length === 0) {
      return { masterColsForDisplay: cols, masterFilteredListHasBothPayoutModes: false };
    }
    let hasModeA = false;
    let hasModeB = false;
    for (const row of masterTabFilteredList) {
      if (isPayoutModeB(String(row.專案類型 ?? ""))) hasModeB = true;
      else hasModeA = true;
    }
    const filtered = cols.filter((k) => {
      if (MASTER_PAYOUT_MODE_A_COL_KEYS.has(k)) return hasModeA;
      if (MASTER_PAYOUT_MODE_B_COL_KEYS.has(k)) return hasModeB;
      if (MASTER_PAYOUT_MODE_A_ONLY_COL_KEYS.has(k)) return hasModeA;
      if (MASTER_PAYOUT_MODE_B_ONLY_COL_KEYS.has(k)) return hasModeB;
      return true;
    });
    return {
      masterColsForDisplay: filtered,
      masterFilteredListHasBothPayoutModes: hasModeA && hasModeB,
    };
  }, [masterVisibleCols, masterTabFilteredList]);

  const searchedPartners = useMemo(
    () =>
      filterRowsBySearch(filteredPartners as unknown as Record<string, unknown>[], partnerListCols, deferredPartnersSearch) as unknown as PartnerRow[],
    [filteredPartners, partnerListCols, deferredPartnersSearch, filterRowsBySearch]
  );
  const searchedTasks = useMemo(
    () =>
      filterRowsBySearch(tasksLifecycleFilteredList as unknown as Record<string, unknown>[], tasksVisibleCols, deferredTasksSearch) as unknown as TaskRow[],
    [tasksLifecycleFilteredList, tasksVisibleCols, deferredTasksSearch, filterRowsBySearch]
  );

  const canManageTaskWorkloadView = useMemo(
    () => Boolean(me && ["董事長", "管理者"].includes(me.role)),
    [me]
  );
  const taskWorkloadByAssignee = useMemo(() => aggregateTasksByAssignee(searchedTasks), [searchedTasks]);

  const workloadDrillTasks = useMemo(() => {
    if (!workloadDrill) return [];
    return filterTasksForWorkloadDrill(searchedTasks, workloadDrill.assigneeLabel, workloadDrill.kind);
  }, [searchedTasks, workloadDrill]);

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

  const payoutWorkflowFiltered = useMemo(
    () => dedupedPayoutForDisplay.filter((r) => payoutRowWorkflowStage(r) === payoutWorkflowTab),
    [dedupedPayoutForDisplay, payoutWorkflowTab]
  );

  const payoutWorkflowCounts = useMemo(() => {
    let pending_vendor = 0;
    let pending_payout = 0;
    let settled = 0;
    for (const r of dedupedPayoutForDisplay) {
      const s = payoutRowWorkflowStage(r);
      if (s === "pending_vendor") pending_vendor += 1;
      else if (s === "pending_payout") pending_payout += 1;
      else settled += 1;
    }
    return { pending_vendor, pending_payout, settled };
  }, [dedupedPayoutForDisplay]);

  /** 分潤表頂部儀表：待分潤列的分潤金額加總（同列表②可見範圍與去重後） */
  const payoutPendingPayoutAmountSum = useMemo(() => {
    let sum = 0;
    for (const r of dedupedPayoutForDisplay) {
      if (payoutRowWorkflowStage(r) !== "pending_payout") continue;
      sum += parseNumericField(r.分潤金額);
    }
    return sum;
  }, [dedupedPayoutForDisplay]);

  /** 分潤表頂部儀表：已分潤列的分潤金額加總（同上口徑） */
  const payoutSettledAmountSum = useMemo(() => {
    let sum = 0;
    for (const r of dedupedPayoutForDisplay) {
      if (payoutRowWorkflowStage(r) !== "settled") continue;
      sum += parseNumericField(r.分潤金額);
    }
    return sum;
  }, [dedupedPayoutForDisplay]);

  const searchedPayout = useMemo(
    () =>
      filterRowsBySearch(
        payoutWorkflowFiltered as unknown as Record<string, unknown>[],
        payoutVisibleCols,
        deferredPayoutSearch
      ) as unknown as PayoutRow[],
    [payoutWorkflowFiltered, payoutVisibleCols, deferredPayoutSearch, filterRowsBySearch]
  );
  const searchedFinance = useMemo(
    () => filterRowsBySearch(finance as unknown as Record<string, unknown>[], financeVisibleCols, deferredFinanceSearch),
    [finance, financeVisibleCols, deferredFinanceSearch, filterRowsBySearch]
  );
  const searchedInvoices = useMemo(
    () => filterRowsBySearch(monthFilteredInvoices as unknown as Record<string, unknown>[], invoicesVisibleCols, deferredInvoicesSearch),
    [monthFilteredInvoices, invoicesVisibleCols, deferredInvoicesSearch, filterRowsBySearch]
  );
  const searchedPaymentRecords = useMemo(
    () =>
      filterRowsBySearch(
        paymentRecords as unknown as Record<string, unknown>[],
        paymentRecordsVisibleCols,
        deferredPaymentRecordsSearch
      ) as unknown as PaymentRecordRow[],
    [paymentRecords, paymentRecordsVisibleCols, deferredPaymentRecordsSearch, filterRowsBySearch]
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
  const visibleInvoiceIds = useMemo(
    () => visibleInvoicesRows.map((inv) => inv.id).filter((id): id is string => typeof id === "string" && id.trim() !== ""),
    [visibleInvoicesRows]
  );
  const visiblePaymentRecordsRows = useMemo(
    () => searchedPaymentRecords.slice(0, paymentRecordsRenderCount),
    [searchedPaymentRecords, paymentRecordsRenderCount]
  );

  async function updateProjectStatusInline(row: MasterRow, nextStatus: string) {
    const id = String(row.id ?? "").trim();
    if (!id || inlineStatusSavingId) return;
    const currentStatus = String(row.專案狀態 ?? "").trim();
    if (nextStatus.trim() === currentStatus) return;
    setInlineStatusError(null);
    setInlineStatusSavingId(id);
    try {
      const res = await fetch("/api/master", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          id,
          專案名稱: row.專案名稱 ?? "",
          專案類型: row.專案類型 ?? "",
          專案狀態: nextStatus,
          長期案: Boolean(row.長期案),
          狀態確認日期: normalizeDateForInput(row.狀態確認日期),
          開案日期: normalizeDateForInput(row.開案日期),
          廠商預計付款日: normalizeDateForInput(row.廠商預計付款日),
          專案資料夾: row.專案資料夾 ?? "",
          專案總金額未稅: row.專案總金額未稅 ?? "",
          專案成本: row.專案成本 ?? "",
          KOL費用未稅: row.KOL費用未稅 ?? "",
          專案營收: calc專案營收(
            row.專案總金額未稅 ?? "",
            row.專案成本 ?? "",
            row.KOL費用未稅 ?? ""
          ),
          專案費用類型: row.專案費用類型 ?? "",
          KOL名稱: row.KOL名稱 ?? "",
          經紀人: row.經紀人 ?? "",
          廠商名稱: row.廠商名稱 ?? "",
          專案BDPM: row.專案BDPM ?? "",
          專案引薦人: row.專案引薦人 ?? "",
          專案開發人: row.專案開發人 ?? "",
          專案管理員: row.專案管理員 ?? "",
          執行管理員: row.執行管理員 ?? "",
          專案內容: row.專案內容 ?? "",
          備註: row.備註 ?? "",
        }),
      });
      const data = (await safeResJson(res)) as { ok?: boolean; error?: string; master?: MasterRow };
      if (!res.ok || !data.ok || !data.master) {
        setInlineStatusError(data.error ?? "更新專案狀態失敗");
        return;
      }
      setMasterList((prev) => prev.map((r) => (r.id === data.master!.id ? data.master! : r)));
      setSelectedMaster((prev) => {
        if (!prev || prev.id !== data.master!.id) return prev;
        return data.master!;
      });
      await refreshDashboardData(["master", "payout", "finance"]);
    } catch (err) {
      setInlineStatusError(err instanceof Error ? err.message : "更新專案狀態失敗");
    } finally {
      setInlineStatusSavingId(null);
    }
  }

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
  }, [activeSection, searchedPayout.length, payoutWorkflowTab]);

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
    if (activeSection !== "finance" || financeSubTab !== "byProject") return;
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
  }, [activeSection, financeSubTab, searchedFinance.length]);

  useEffect(() => {
    if (activeSection !== "finance" || financeSubTab !== "invoices") return;
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
  }, [activeSection, financeSubTab, searchedInvoices.length]);

  useEffect(() => {
    setSelectedInvoiceIds((prev) => prev.filter((id) => invoices.some((inv) => inv.id === id)));
  }, [invoices]);

  useEffect(() => {
    if (!invoiceMonthTabs.some((tab) => tab.key === invoiceMonthTab)) {
      setInvoiceMonthTab("all");
    }
  }, [invoiceMonthTab, invoiceMonthTabs]);

  useEffect(() => {
    if (activeSection !== "finance" || financeSubTab !== "payments") return;
    setPaymentRecordsRenderCount(RENDER_CHUNK_SIZE);
    if (searchedPaymentRecords.length <= RENDER_CHUNK_SIZE) return;
    let timer: number | undefined;
    const tick = () => {
      setPaymentRecordsRenderCount((prev) => {
        const next = Math.min(prev + RENDER_CHUNK_SIZE, searchedPaymentRecords.length);
        if (next < searchedPaymentRecords.length) timer = window.setTimeout(tick, 0);
        return next;
      });
    };
    timer = window.setTimeout(tick, 0);
    return () => { if (timer) window.clearTimeout(timer); };
  }, [activeSection, financeSubTab, searchedPaymentRecords.length]);

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
      長期案: Boolean(selectedMaster.長期案),
      狀態確認日期: normalizeDateForInput(selectedMaster.狀態確認日期),
      開案日期: normalizeDateForInput(selectedMaster.開案日期),
      廠商預計付款日: normalizeDateForInput(selectedMaster.廠商預計付款日),
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
      經紀人: selectedMaster.經紀人 ?? "",
      廠商名稱: selectedMaster.廠商名稱 ?? "",
      專案BDPM: selectedMaster.專案BDPM ?? "",
      專案BDPM分潤成數: selectedMaster.專案BDPM分潤成數 ?? "",
      專案引薦人: selectedMaster.專案引薦人 ?? "",
      專案引薦人分潤成數: selectedMaster.專案引薦人分潤成數 ?? "",
      專案開發人: selectedMaster.專案開發人 ?? "",
      專案開發人分潤成數: selectedMaster.專案開發人分潤成數 ?? "",
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
          const tables = d.visibility.tables ?? [];
          let cols = d.visibility.columns ?? {};
          const legacy = d.visibility.overview_kpis;
          if (
            (!cols.overview || cols.overview.length === 0) &&
            Array.isArray(legacy) &&
            legacy.length > 0
          ) {
            cols = { ...cols, overview: [...legacy] };
          }
          let nextTables = tables;
          if (cols.overview && cols.overview.length > 0 && !nextTables.includes("overview")) {
            nextTables = [...nextTables, "overview"];
          }
          setVisibilityTables(nextTables);
          setVisibilityColumns(cols);
        } else {
          setVisibilityTables([]);
          setVisibilityColumns({});
        }
      })
      .catch(() => {
        setVisibilityTables([]);
        setVisibilityColumns({});
      });
  }, [selectedUserForVisibility]);

  useEffect(() => {
    if (!selectedTask) return;
    setEditTaskForm({
      任務名稱: selectedTask.任務 ?? "",
      任務類型: selectedTask.任務類型 ?? "",
      任務負責人: selectedTask.任務負責人 ?? "",
      到期日: selectedTask.到期日?.trim() ? selectedTask.到期日.trim().slice(0, 10) : "",
      任務完成: Boolean(selectedTask.任務完成),
      備註: selectedTask.備註 ?? "",
    });
  }, [selectedTask]);

  useEffect(() => {
    if (tasksSectionViewMode !== "byAssignee") setWorkloadDrill(null);
  }, [tasksSectionViewMode]);

  useEffect(() => {
    if (tasksLifecycleTab === "completed" && tasksSectionViewMode === "byAssignee") {
      setTasksSectionViewMode("list");
    }
  }, [tasksLifecycleTab, tasksSectionViewMode]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (showChangePassword) {
        setShowChangePassword(false);
        setChangePasswordError(null);
        setChangePasswordMessage(null);
        setChangePasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      } else if (selectedTask) {
        setSelectedTask(null);
        setSaveTaskError(null);
      } else if (selectedMaster) {
        if (showDeleteMasterConfirm) {
          setShowDeleteMasterConfirm(false);
          return;
        }
        setSelectedMaster(null);
        setIsEditingMaster(false);
        setSaveMasterError(null);
        setShowDeleteMasterConfirm(false);
      } else if (workloadDrill) {
        setWorkloadDrill(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedMaster, selectedTask, showDeleteMasterConfirm, showChangePassword, workloadDrill]);

  const refreshDashboardData = useCallback(
    async (
      targets: Array<"users" | "master" | "tasks" | "partners" | "myVisibility" | "visibilityRules" | "systemConfig" | "invoices" | "finance" | "payout" | "payments"> = [
        "users", "master", "tasks", "partners", "myVisibility", "visibilityRules", "systemConfig", "invoices", "finance", "payout", "payments",
      ]
    ) => {
      const need = new Set(targets);
      const reqs: Promise<unknown>[] = [];
      if (need.has("users")) {
        reqs.push(
          fetch("/api/users", { cache: "no-store" })
            .then(safeResJson)
            .then((res) => {
              if (!(res as { ok?: boolean }).ok) return;
              setUsers(((res as { users?: User[] }).users) ?? []);
            })
        );
      }
      if (need.has("master")) {
        reqs.push(
          fetch("/api/master", { cache: "no-store" })
            .then(safeResJson)
            .then((res) => {
              if (!(res as { ok?: boolean }).ok) return;
              setMasterList(((res as { list?: MasterRow[] }).list) ?? []);
            })
        );
      }
      if (need.has("tasks")) {
        reqs.push(
          fetch("/api/tasks", { cache: "no-store" })
            .then(safeResJson)
            .then((res) => {
              if (!(res as { ok?: boolean }).ok) return;
              setTasks(((res as { tasks?: TaskRow[] }).tasks) ?? []);
            })
        );
      }
      if (need.has("partners")) {
        reqs.push(
          fetch("/api/partners", { cache: "no-store" })
            .then(safeResJson)
            .then((res) => {
              if (!(res as { ok?: boolean }).ok) return;
              const ptVal = res as { partners?: PartnerRow[]; partnersError?: string };
              setPartners(ptVal.partners ?? []);
              setPartnersLoadError(ptVal.partnersError ?? null);
            })
        );
      }
      if (need.has("myVisibility")) {
        reqs.push(
          fetch("/api/user-visibility/me", { cache: "no-store" })
            .then(safeResJson)
            .then((res) => {
              if (!(res as { ok?: boolean }).ok) return;
              const v = res as { tables?: string[]; columns?: Record<string, string[]>; overview_kpis?: string[] | null };
              setMyVisibility({
                tables: v.tables ?? [],
                columns: v.columns ?? {},
                overview_kpis: v.overview_kpis !== undefined ? v.overview_kpis : null,
              });
            })
        );
      }
      if (need.has("visibilityRules")) {
        reqs.push(
          fetch("/api/visibility-rules", { cache: "no-store" })
            .then(safeResJson)
            .then((res) => {
              if (!(res as { ok?: boolean }).ok) return;
              setVisibilityRules(((res as { rules?: Record<string, string[]> }).rules) ?? {});
            })
        );
      }
      if (need.has("systemConfig")) {
        reqs.push(
          fetch("/api/system-config", { cache: "no-store" })
            .then(safeResJson)
            .then((res) => {
              if (!(res as { ok?: boolean }).ok) return;
              const c = (res as {
                config?: {
                  master_payout_defaults: Record<string, string>;
                  project_types: string[];
                  project_status_options?: string[];
                  project_expense_type_options?: string[];
                  task_type_options?: string[];
                  role_visibility: Record<string, { sections: string[] }>;
                  roles?: string[];
                  payout_dedupe_rules?: PayoutDedupeRulesByMode;
                  overview_kpi_by_role?: Record<string, string[]>;
                };
              }).config;
              if (c) setSystemConfig(c);
            })
        );
      }
      if (need.has("invoices") || need.has("finance")) {
        reqs.push(
          fetch("/api/invoices", { cache: "no-store" })
            .then(safeResJson)
            .then((res) => {
              if (!(res as { ok?: boolean }).ok) return;
              setInvoices(((res as { invoices?: InvoiceRow[] }).invoices) ?? []);
            })
        );
      }
      if (need.has("finance")) {
        reqs.push(
          fetch("/api/finance", { cache: "no-store" })
            .then(safeResJson)
            .then((res) => {
              if (!(res as { ok?: boolean }).ok) return;
              setFinance(((res as { finance?: FinanceRow[] }).finance) ?? []);
            })
        );
      }
      if (need.has("payments") || need.has("finance")) {
        reqs.push(
          fetch("/api/finance-payments", { cache: "no-store" })
            .then(safeResJson)
            .then((res) => {
              if (!(res as { ok?: boolean }).ok) return;
              setPaymentRecords(((res as { payments?: PaymentRecordRow[] }).payments) ?? []);
            })
        );
      }
      if (need.has("payout")) {
        reqs.push(
          fetch("/api/payout", { cache: "no-store" })
            .then(safeResJson)
            .then((res) => {
              if (!(res as { ok?: boolean }).ok) return;
              setPayoutList(((res as { list?: PayoutRow[] }).list) ?? []);
            })
        );
      }
      await Promise.allSettled(reqs);
    },
    []
  );

  useLayoutEffect(() => {
    invoicesRef.current = invoices;
  }, [invoices]);

  /** 發票清冊：寫回 DB（整列一併更新） */
  const persistInvoiceRowById = useCallback(
    async (id: string) => {
      if (!id) return;
      if (invoiceSaveInflightRef.current.has(id)) {
        invoiceSavePendingRef.current.add(id);
        return;
      }
      const row = invoicesRef.current.find((r) => r.id === id);
      if (!row?.id) return;
      invoiceSaveInflightRef.current.add(id);
      setInvoiceEditSavingId(id);
      setInvoiceEditError(null);
      try {
        const res = await fetch("/api/invoices", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: row.id, ...invoiceRowToInsertInput(row) }),
        });
        const data = (await safeResJson(res)) as { ok?: boolean; error?: string; invoice?: InvoiceRow };
        if (!res.ok || data.ok === false) {
          setInvoiceEditError(String(data.error ?? "儲存失敗"));
          return;
        }
        if (data.invoice) {
          setInvoices((prev) => prev.map((r) => (r.id === id ? { ...r, ...data.invoice } : r)));
        }
        await refreshDashboardData(["finance"]);
      } catch (e) {
        setInvoiceEditError(e instanceof Error ? e.message : "儲存失敗");
      } finally {
        invoiceSaveInflightRef.current.delete(id);
        setInvoiceEditSavingId((cur) => (cur === id ? null : cur));
        if (invoiceSavePendingRef.current.has(id)) {
          invoiceSavePendingRef.current.delete(id);
          queueMicrotask(() => {
            void persistInvoiceRowById(id);
          });
        }
      }
    },
    [refreshDashboardData]
  );

  const deleteInvoicesByIdList = useCallback(
    async (ids: string[]) => {
      const cleanIds = [...new Set(ids.map((id) => String(id ?? "").trim()).filter(Boolean))];
      if (cleanIds.length === 0) return;
      const label = cleanIds.length === 1 ? "這筆發票" : `已選取的 ${cleanIds.length} 筆發票`;
      if (!window.confirm(`確定要刪除${label}？此操作無法復原。`)) return;
      setInvoiceEditError(null);
      setDeletingInvoiceIds((prev) => [...new Set([...prev, ...cleanIds])]);
      try {
        const res = await fetch("/api/invoices", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: cleanIds }),
        });
        const data = (await safeResJson(res)) as { ok?: boolean; error?: string; count?: number };
        if (!res.ok || data.ok === false) {
          setInvoiceEditError(String(data.error ?? "刪除失敗"));
          return;
        }
        const deletedSet = new Set(cleanIds);
        setInvoices((prev) => prev.filter((inv) => !inv.id || !deletedSet.has(inv.id)));
        setSelectedInvoiceIds((prev) => prev.filter((id) => !deletedSet.has(id)));
        await refreshDashboardData(["finance"]);
      } catch (e) {
        setInvoiceEditError(e instanceof Error ? e.message : "刪除失敗");
      } finally {
        const done = new Set(cleanIds);
        setDeletingInvoiceIds((prev) => prev.filter((id) => !done.has(id)));
      }
    },
    [refreshDashboardData]
  );

  useLayoutEffect(() => {
    paymentRecordsRef.current = paymentRecords;
  }, [paymentRecords]);

  /** 付款記錄：輸入時只更新畫面，離開欄位才寫回 DB */
  const persistPaymentRecordById = useCallback(
    async (id: string) => {
      if (!id) return;
      if (paymentSaveInflightRef.current.has(id)) {
        paymentSavePendingRef.current.add(id);
        return;
      }
      const row = paymentRecordsRef.current.find((r) => r.id === id);
      if (!row?.id) return;
      paymentSaveInflightRef.current.add(id);
      setPaymentEditSavingId(id);
      setPaymentEditError(null);
      try {
        const res = await fetch("/api/finance-payments", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: row.id, ...paymentRecordRowToInput(row) }),
        });
        const data = (await safeResJson(res)) as { ok?: boolean; error?: string; payment?: PaymentRecordRow };
        if (!res.ok || data.ok === false) {
          setPaymentEditError(String(data.error ?? "儲存失敗"));
          return;
        }
        if (data.payment) {
          setPaymentRecords((prev) => prev.map((r) => (r.id === id ? { ...r, ...data.payment } : r)));
        }
      } catch (e) {
        setPaymentEditError(e instanceof Error ? e.message : "儲存失敗");
      } finally {
        paymentSaveInflightRef.current.delete(id);
        setPaymentEditSavingId((cur) => (cur === id ? null : cur));
        if (paymentSavePendingRef.current.has(id)) {
          paymentSavePendingRef.current.delete(id);
          queueMicrotask(() => {
            void persistPaymentRecordById(id);
          });
        }
      }
    },
    []
  );

  useLayoutEffect(() => {
    financeRef.current = finance;
  }, [finance]);

  /** 財務依專案：僅「廠商付款日期」「員工分潤日期」寫回 DB（不重打 GET，避免整表 reload 覆蓋本地狀態） */
  const persistFinanceRowBy專案ID = useCallback(async (專案IDKey: string) => {
    if (!專案IDKey) return;
    if (financeSaveInflightRef.current.has(專案IDKey)) {
      financeSavePendingRef.current.add(專案IDKey);
      return;
    }
    const row = financeRef.current.find((r) => String(r.專案ID ?? "").trim() === 專案IDKey);
    if (!row || !String(row.專案ID ?? "").trim()) return;
    financeSaveInflightRef.current.add(專案IDKey);
    setFinanceEditSaving專案ID(專案IDKey);
    setFinanceEditError(null);
    try {
      const res = await fetch("/api/finance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 專案ID: row.專案ID, ...financeRowToUpdatePayload(row) }),
      });
      const data = (await safeResJson(res)) as { ok?: boolean; error?: string; finance?: FinanceRow };
      if (!res.ok || data.ok === false) {
        setFinanceEditError(String(data.error ?? "儲存失敗"));
        return;
      }
      if (data.finance) {
        setFinance((prev) =>
          prev.map((r) =>
            String(r.專案ID ?? "").trim() === 專案IDKey
              ? { ...r, ...data.finance, 專案名稱: r.專案名稱 ?? data.finance?.專案名稱 }
              : r
          )
        );
      }
      await refreshDashboardData(["payout"]);
    } catch (e) {
      setFinanceEditError(e instanceof Error ? e.message : "儲存失敗");
    } finally {
      financeSaveInflightRef.current.delete(專案IDKey);
      setFinanceEditSaving專案ID((cur) => (cur === 專案IDKey ? null : cur));
      if (financeSavePendingRef.current.has(專案IDKey)) {
        financeSavePendingRef.current.delete(專案IDKey);
        queueMicrotask(() => {
          void persistFinanceRowBy專案ID(專案IDKey);
        });
      }
    }
  }, [refreshDashboardData]);

  const refetchTasksOnly = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks", { cache: "no-store" });
      const data = (await safeResJson(res)) as { ok?: boolean; tasks?: TaskRow[] };
      if (res.ok && data.ok && Array.isArray(data.tasks)) setTasks(data.tasks);
    } catch {
      /* 忽略 */
    }
  }, []);

  /** 任務分頁／大總表：背景同步他人更新（避免僅能靠整頁重新整理） */
  useEffect(() => {
    if (!me) return;
    if (activeSection !== "tasks" && activeSection !== "master") return;
    void refetchTasksOnly();
    const id = window.setInterval(() => {
      void refetchTasksOnly();
    }, 8000);
    return () => window.clearInterval(id);
  }, [me, activeSection, refetchTasksOnly]);

  useEffect(() => {
    if (!me) return;
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      if (activeSection !== "tasks" && activeSection !== "master") return;
      void refetchTasksOnly();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [me, activeSection, refetchTasksOnly]);

  /** 新增／編輯合作夥伴 Modal 開啟時：自 DB 重新載入 Users 與表單選項（人員增刪後清單即更新） */
  useEffect(() => {
    if (!showCreatePartner && !showEditPartner) return;
    void refreshDashboardData(["users"]);
    void fetchPartnerFormOptions();
  }, [showCreatePartner, showEditPartner, refreshDashboardData, fetchPartnerFormOptions]);

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
        if (String(sess.user.role ?? "").trim() === "KOL") {
          window.location.replace("/kol");
          return;
        }
        setMe(sess.user);
        setLoading(false);
        await refreshDashboardData(["users", "master", "tasks", "partners", "myVisibility", "systemConfig"]);
        void refreshDashboardData(["visibilityRules", "invoices", "finance", "payout"]);
      })
      .catch(() => {
        setError("無法驗證登入狀態，請重新登入");
        setLoading(false);
      });
  }, [refreshDashboardData]);

  useEffect(() => {
    try {
      const v = localStorage.getItem("sdh-dashboard-sidebar-collapsed");
      if (v === "1") setSidebarCollapsed(true);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("sdh-dashboard-sidebar-collapsed", sidebarCollapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    try {
      localStorage.setItem("sdh-master-subtab", masterSubTab);
    } catch {
      /* ignore */
    }
  }, [masterSubTab]);

  useEffect(() => {
    try {
      localStorage.setItem("sdh-master-lifecycle-tab", masterLifecycleTab);
    } catch {
      /* ignore */
    }
  }, [masterLifecycleTab]);

  useEffect(() => {
    try {
      localStorage.setItem("sdh-master-long-term-filter", masterLongTermFilter);
    } catch {
      /* ignore */
    }
  }, [masterLongTermFilter]);

  useEffect(() => {
    try {
      localStorage.setItem("sdh-master-created-sort-direction", masterCreatedSortDirection);
    } catch {
      /* ignore */
    }
  }, [masterCreatedSortDirection]);

  useEffect(() => {
    try {
      localStorage.setItem("sdh-tasks-lifecycle-tab", tasksLifecycleTab);
    } catch {
      /* ignore */
    }
  }, [tasksLifecycleTab]);

  useEffect(() => {
    try {
      const v = localStorage.getItem("sdh-finance-subtab");
      if (v === "invoices" || v === "byProject" || v === "payments") setFinanceSubTab(v);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("sdh-finance-subtab", financeSubTab);
    } catch {
      /* ignore */
    }
  }, [financeSubTab]);

  useEffect(() => {
    try {
      const v = localStorage.getItem("sdh-payout-workflow-tab");
      if (v === "pending_vendor" || v === "pending_payout" || v === "settled") setPayoutWorkflowTab(v);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("sdh-payout-workflow-tab", payoutWorkflowTab);
    } catch {
      /* ignore */
    }
  }, [payoutWorkflowTab]);

  /** system_config 首次載入後還原大總表子分頁（僅一次） */
  const masterSubTabRestored = useRef(false);
  useEffect(() => {
    if (masterSubTabRestored.current || !systemConfig) return;
    masterSubTabRestored.current = true;
    try {
      const v = localStorage.getItem("sdh-master-subtab");
      if (!v) return;
      const opts = systemConfig.project_types ?? [...PROJECT_TYPES];
      if (v === "全部" || opts.includes(v)) setMasterSubTab(v);
    } catch {
      /* ignore */
    }
  }, [systemConfig]);

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

  async function handleChangeMyPassword(e: React.FormEvent) {
    e.preventDefault();
    setChangePasswordError(null);
    setChangePasswordMessage(null);
    const currentPassword = changePasswordForm.currentPassword.trim();
    const newPassword = changePasswordForm.newPassword.trim();
    const confirmPassword = changePasswordForm.confirmPassword.trim();
    if (!currentPassword || !newPassword || !confirmPassword) {
      setChangePasswordError("請完整填寫目前密碼、新密碼與確認密碼");
      return;
    }
    if (newPassword.length < 6) {
      setChangePasswordError("新密碼至少需要 6 個字元");
      return;
    }
    if (newPassword !== confirmPassword) {
      setChangePasswordError("新密碼與確認密碼不一致");
      return;
    }
    setChangingPassword(true);
    try {
      const res = await fetch("/api/users/password", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = (await safeResJson(res)) as { ok?: boolean; error?: string; message?: string };
      if (!res.ok || !data.ok) {
        const fromApi = typeof data.error === "string" ? data.error.trim() : "";
        const errText = fromApi
          ? fromApi
          : `修改密碼失敗（HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}）`;
        setChangePasswordError(errText);
        setChangingPassword(false);
        return;
      }
      setChangePasswordMessage(data.message ?? "密碼已更新");
      setChangePasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    } catch (err) {
      setChangePasswordError(
        err instanceof Error ? err.message : `請求失敗：${String(err)}`
      );
    }
    setChangingPassword(false);
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#faf8f5]">
      {/* Logo 獨立頂列（不包在深色側欄內） */}
      {me && tabSections.length > 0 && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-stone-200/90 bg-[#faf8f5] px-4 py-3 md:px-8">
          <Link href="/" className="block min-w-0 max-w-full" onClick={() => setMobileNavOpen(false)}>
            <Image
              src="/logo.png"
              alt="SDH 盛德好"
              width={1257}
              height={174}
              sizes="(max-width: 768px) 100vw, 260px"
              className="h-7 w-auto max-w-[min(100%,260px)] object-contain object-left sm:h-8 md:h-[2.25rem]"
            />
          </Link>
          <button
            type="button"
            className="shrink-0 rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-800 shadow-sm md:hidden"
            onClick={() => setMobileNavOpen(true)}
            aria-label="開啟選單"
          >
            ☰
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* 深色側欄：僅從 Logo 列下方開始（頂天立地至視窗底） */}
        {me && tabSections.length > 0 && (
          <>
            <div
              className={`fixed bottom-0 left-0 right-0 top-14 z-40 bg-stone-900/45 transition-opacity md:hidden ${mobileNavOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}
              aria-hidden
              onClick={() => setMobileNavOpen(false)}
            />
            <aside
              className={`fixed bottom-0 left-0 top-14 z-50 flex flex-col border-r border-stone-700/90 bg-gradient-to-b from-stone-900 via-stone-900 to-stone-950 text-stone-100 shadow-2xl shadow-black/30 transition-transform duration-200 ease-out md:static md:top-auto md:z-0 md:max-h-none md:min-h-0 md:translate-x-0 md:self-stretch md:shadow-none ${
                mobileNavOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
              } ${sidebarCollapsed ? "md:w-[4.25rem]" : "w-[min(100vw,17rem)] md:w-56"}`}
            >
              <div className="flex h-11 shrink-0 items-center justify-end gap-1 border-b border-stone-700/80 px-2">
                <button
                  type="button"
                  className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full text-stone-400 transition-all duration-150 hover:bg-stone-800/90 hover:text-amber-300 md:inline-flex"
                  onClick={() => setSidebarCollapsed((c) => !c)}
                  aria-label={sidebarCollapsed ? "展開側欄" : "收合側欄"}
                >
                  <span aria-hidden className="text-lg">{sidebarCollapsed ? "»" : "«"}</span>
                </button>
                <button
                  type="button"
                  className="rounded-lg p-2 text-stone-400 transition hover:bg-stone-800 md:hidden"
                  onClick={() => setMobileNavOpen(false)}
                  aria-label="關閉選單"
                >
                  ✕
                </button>
              </div>
              <p className={`px-3 pt-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-500 ${sidebarCollapsed ? "md:hidden" : ""}`}>
                資料區塊
              </p>
              <nav className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2.5 py-3" aria-label="Dashboard 分頁">
                {tabSections.map((sec) => {
                  const label = TABLE_LABELS[sec] ?? sec;
                  return (
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
                      title={sidebarCollapsed ? label : undefined}
                      onClick={() => {
                        setActiveSection(sec);
                        setMobileNavOpen(false);
                      }}
                      className={`relative w-full overflow-hidden rounded-2xl px-3 py-2.5 text-left text-sm font-semibold transition-all duration-150 ease-out before:pointer-events-none before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-r-full before:transition-all before:duration-150 before:content-[''] ${
                        activeSection === sec
                          ? "bg-stone-800/95 text-amber-200 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] ring-1 ring-amber-400/35 before:bg-amber-400"
                          : "text-stone-300 ring-1 ring-transparent before:bg-transparent hover:bg-stone-800/70 hover:text-white hover:ring-stone-600/40 hover:shadow-sm"
                      } ${sidebarCollapsed ? "md:px-1.5 md:text-center md:text-[10px] md:leading-tight" : ""}`}
                    >
                      <span className={`block min-w-0 ${sidebarCollapsed ? "md:break-words" : "truncate"}`}>{label}</span>
                    </button>
                  );
                })}
              </nav>
              <div className="shrink-0 space-y-2 border-t border-stone-700/80 px-2.5 py-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowChangePassword(true);
                    setChangePasswordError(null);
                    setChangePasswordMessage(null);
                    setChangePasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
                    setMobileNavOpen(false);
                  }}
                  title={sidebarCollapsed ? "修改密碼" : undefined}
                  className={`relative w-full overflow-hidden rounded-2xl px-3 py-2.5 text-left text-sm font-semibold text-stone-300 ring-1 ring-transparent transition-all duration-150 ease-out before:pointer-events-none before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-r-full before:bg-transparent before:transition-all before:duration-150 before:content-[''] hover:bg-stone-800/70 hover:text-white hover:ring-stone-600/40 hover:before:bg-amber-400 ${
                    sidebarCollapsed ? "md:px-1.5 md:text-center md:text-[10px] md:leading-tight" : ""
                  }`}
                >
                  <span className={`block min-w-0 ${sidebarCollapsed ? "md:break-words" : "truncate"}`}>{sidebarCollapsed ? "密碼" : "修改密碼"}</span>
                </button>
                <button
                  type="button"
                  onClick={handleLogout}
                  title={sidebarCollapsed ? "登出" : undefined}
                  className={`relative w-full overflow-hidden rounded-2xl px-3 py-2.5 text-left text-sm font-semibold text-stone-300 ring-1 ring-transparent transition-all duration-150 ease-out before:pointer-events-none before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-r-full before:bg-transparent before:transition-all before:duration-150 before:content-[''] hover:bg-stone-800/70 hover:text-white hover:ring-stone-600/40 hover:before:bg-amber-400 ${
                    sidebarCollapsed ? "md:px-1.5 md:text-center md:text-[10px] md:leading-tight" : ""
                  }`}
                >
                  <span className={`block min-w-0 ${sidebarCollapsed ? "md:break-words" : "truncate"}`}>{sidebarCollapsed ? "登出" : "登出系統"}</span>
                </button>
              </div>
              <p className={`mt-auto shrink-0 border-t border-stone-700/80 px-3 py-3 text-[10px] leading-relaxed text-stone-500 ${sidebarCollapsed ? "md:hidden" : ""}`}>
                拖曳項目可調整順序。目前：
                <span className="font-semibold text-amber-400">{TABLE_LABELS[activeSection ?? ""] ?? activeSection ?? "—"}</span>
              </p>
            </aside>
          </>
        )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col p-4 md:p-8">

        {(!me || tabSections.length === 0) && (
          <div className="mb-6 flex min-h-[2rem] items-center border-b border-stone-200/90 pb-4">
            <Link href="/" className="block max-w-full">
              <Image
                src="/logo.png"
                alt="SDH 盛德好"
                width={1257}
                height={174}
                sizes="(max-width: 768px) 100vw, 260px"
                className="h-7 w-auto max-w-[min(100%,260px)] object-contain object-left sm:h-8 md:h-[2.25rem]"
              />
            </Link>
          </div>
        )}

        <header className="mb-8 flex flex-wrap items-center justify-between gap-4 md:mb-10">
          <div>
            <Link href="/" className="text-sm font-medium text-stone-500 transition duration-150 hover:text-amber-800">
              ← 首頁
            </Link>
            <div className="mt-2 border-l-4 border-amber-500/80 pl-4">
              <h1 className="text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl">
                {me?.name ?? "總覽"} Dashboard
              </h1>
            </div>
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
        </header>

        {me && tabSections.length > 0 && (
          <div className="min-w-0 flex-1 space-y-10">
            {/* 管理者專用：可見性與權限管理分頁內容 */}
            {canEditVisibility && activeSection === "visibility" && (
              <section className="rounded-2xl border-2 border-amber-200 bg-white/90 p-6 shadow-xl ring-1 ring-amber-500/20">
                <h2 className="mb-2 text-xl font-bold tracking-tight text-amber-800">可見性與權限管理</h2>
                <p className="mb-4 text-sm text-stone-500">依序設定：角色管理 → ① 角色可見區塊 → ② 資料可見規則 → ③ 使用者可見範圍（含總覽頂部指標，與其他分頁欄位同一套）</p>
                <p className="mb-4 text-sm text-stone-600">
                  <strong className="text-amber-800">系統設定</strong>（分潤預設、專案類型、
                  <strong className="text-amber-800">專案狀態</strong>
                  、任務類型、專案權限等）在本頁下方「
                  <a href="#dashboard-system-settings" className="font-semibold text-amber-800 underline decoration-amber-300 underline-offset-2 hover:text-amber-700">
                    系統設定
                  </a>
                  」區塊，儲存後寫入 <code className="rounded bg-stone-100 px-1 text-xs">system_config</code>。
                </p>

                {/* 如何連結：可收合說明 */}
                <div className="mb-6 rounded-xl border border-stone-200/90 bg-white/90 p-4">
                  <button type="button" onClick={() => setShowHowItWorks((v) => !v)} className="flex w-full items-center justify-between text-left text-sm font-medium text-stone-600 hover:text-amber-800">
                    <span>📋 資料如何連結、存在哪裡（點擊展開）</span>
                    <span className="text-stone-500">{showHowItWorks ? "▼" : "▶"}</span>
                  </button>
                  {showHowItWorks && (
                    <div className="mt-4 space-y-3 border-t border-stone-200/90 pt-4 text-xs text-stone-500">
                      <p><strong className="text-stone-600">角色列表</strong> → 存於 <code className="rounded bg-stone-100 px-1">system_config</code> 的 <code className="rounded bg-stone-100 px-1">roles</code>（陣列）。新增使用者時的角色下拉與這裡一致。</p>
                      <p><strong className="text-stone-600">① 角色可見區塊</strong> → 存於 <code className="rounded bg-stone-100 px-1">system_config</code> 的 <code className="rounded bg-stone-100 px-1">role_visibility</code>。每個角色可勾選資料區塊（不含總覽；總覽分頁與頂部指標在 ③ 依帳號設定）。</p>
                      <p><strong className="text-stone-600">總覽頂部指標</strong> → 在 ③ 勾選「總覽」Table 後，於子欄位勾選（與大總表等相同），存於 <code className="rounded bg-stone-100 px-1">user_visibility.columns.overview</code>；舊資料可能仍在 <code className="rounded bg-stone-100 px-1">overview_kpis</code>。系統並以 <code className="rounded bg-stone-100 px-1">overview_kpi_by_role</code> 作為未細選時的預設。</p>
                      <p><strong className="text-stone-600">② 資料可見規則</strong> → 存於 <code className="rounded bg-stone-100 px-1">visibility_rules</code> 表。勾選的欄位若符合登入者姓名/Email，該列才會顯示（列級過濾）。</p>
                      <p><strong className="text-stone-600">③ 使用者可見範圍</strong> → 存於 <code className="rounded bg-stone-100 px-1">user_visibility</code> 表（依 user_email）。若某使用者有設定，會覆蓋 ①，且可細到「每個 Table 顯示哪些欄位」。</p>
                      <p>
                        <strong className="text-stone-600">下方「系統設定」</strong> → 存於 <code className="rounded bg-stone-100 px-1">system_config</code>：
                        <code className="ml-1 rounded bg-stone-100 px-1">project_types</code>（專案類型）、
                        <code className="rounded bg-stone-100 px-1">project_status_options</code>（大總表專案狀態下拉）、
                        <code className="rounded bg-stone-100 px-1">task_type_options</code>（任務類型下拉），以及分潤與權限等。
                      </p>
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
                              const raw = current[role] ?? ROLE_VISIBILITY[role] ?? { sections: ["overview", "tasks"] };
                              const secs = raw.sections ?? [];
                              const rest = secs.filter((s) => s !== "overview");
                              rv[role] = { ...raw, sections: ["overview", ...rest] };
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
                    <p className="mb-3 text-xs text-stone-500">
                      各角色可進入的資料區塊（不含「總覽」：總覽分頁與頂部指標改由 ③ 依帳號勾選「總覽」及子欄位）。儲存時會自動為每個角色帶入總覽區塊權限。
                    </p>
                    <div className="space-y-2">
                      {displayRoles.map((role) => {
                        const cfg = systemConfig?.role_visibility?.[role] ?? ROLE_VISIBILITY[role] ?? { sections: ["overview", "tasks"] };
                        return [role, cfg] as const;
                      }).map(([role, cfg]) => {
                        const sectionsRaw = cfg?.sections ?? [];
                        const sectionsNoOverview = sectionsRaw.filter((x) => x !== "overview");
                        return (
                        <div key={role} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                          <span className="w-16 text-xs font-medium text-stone-900">{role}</span>
                          <div className="flex flex-wrap gap-x-2 gap-y-1">
                            {ROLE_SECTION_KEYS_FOR_UI.map((s) => {
                              const checked = sectionsNoOverview.includes(s);
                              return (
                                <label key={s} className="flex cursor-pointer items-center gap-1">
                                  <input type="checkbox" checked={checked} onChange={() => {
                                    const next = checked ? sectionsNoOverview.filter((x) => x !== s) : [...sectionsNoOverview, s];
                                    const merged = ["overview", ...next];
                                    setSystemConfig((c) => {
                                      const base = c ?? { master_payout_defaults: { ...MASTER_PAYOUT_DEFAULTS }, project_types: [...PROJECT_TYPES], role_visibility: {} };
                                      const rv = { ...base.role_visibility, [role]: { ...(typeof cfg === "object" ? cfg : {}), sections: merged } };
                                      return { ...base, role_visibility: rv };
                                    });
                                  }} className="h-3 w-3 rounded border-stone-300 bg-stone-50 text-amber-500" />
                                  <span className="text-xs text-stone-600">{TABLE_LABELS[s] ?? s}</span>
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
                      {TABLE_KEYS.filter((k) => k !== "overview").map((tableKey) => {
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
                      點選使用者可設定各 Table 可見欄位；「總覽」下可勾選頂部指標（與其他分頁相同邏輯）。
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
          <section className="rounded-3xl border border-stone-200/80 bg-gradient-to-br from-white via-white to-amber-50/40 p-4 shadow-lg shadow-stone-300/40 ring-1 ring-amber-100/50 sm:p-6">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="border-l-4 border-amber-500 pl-4">
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
                    className="rounded-2xl border border-stone-200/70 bg-white/95 px-3 py-3 shadow-md shadow-stone-200/50 ring-1 ring-amber-100/40 transition-all duration-150 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-amber-200/40 sm:px-4"
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
              <div className="min-w-0 rounded-2xl border border-stone-200/80 bg-white/95 p-4 shadow-sm shadow-stone-200/50 ring-1 ring-stone-100/80">
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

              <div className="min-w-0 rounded-2xl border border-stone-200/80 bg-white/95 p-4 shadow-sm shadow-stone-200/50 ring-1 ring-stone-100/80">
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
                          <th className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-stone-600">任務類型</th>
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
                            <td className="whitespace-nowrap px-3 py-2 text-stone-600">{t.任務類型 ?? "—"}</td>
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
            <div className="mb-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
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
                      專案類型: masterSubTab !== "全部" ? masterSubTab : "",
                      專案狀態: "",
                      長期案: false,
                      狀態確認日期: "",
                      開案日期: today,
                      廠商預計付款日: "",
                      專案總金額未稅: "",
                      專案營收: "",
                      專案成本: "",
                      KOL費用未稅: "",
                      KOL名稱: "",
                      經紀人: "",
                      專案費用類型: "",
                      廠商名稱: "",
                      專案資料夾: "",
                      專案BDPM: "",
                      專案BDPM分潤成數: payoutDefaults.專案BDPM分潤成數,
                      專案引薦人: "",
                      專案引薦人分潤成數: payoutDefaults.專案引薦人分潤成數,
                      專案開發人: "",
                      專案開發人分潤成數: payoutDefaults.專案開發人分潤成數,
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
              <div className="mt-4 rounded-2xl border border-stone-200/90 bg-gradient-to-br from-stone-50 to-white p-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setMasterLifecycleTab("in_progress")}
                    className={`group min-w-[7rem] rounded-xl border px-3 py-2 text-left text-xs transition cursor-pointer ${
                      masterLifecycleTab === "in_progress"
                        ? "border-amber-300 bg-amber-50 shadow-sm ring-2 ring-amber-200/70"
                        : "border-stone-200 bg-white hover:-translate-y-0.5 hover:border-amber-200 hover:shadow-sm"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-semibold text-stone-700">進行中</div>
                      <span className="text-[10px] text-stone-400 group-hover:text-amber-600">點選</span>
                    </div>
                    <div className="mt-0.5 text-lg font-bold tabular-nums text-stone-900">{masterLifecycleCounts.active}</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMasterLifecycleTab("closed")}
                    className={`group min-w-[7rem] rounded-xl border px-3 py-2 text-left text-xs transition cursor-pointer ${
                      masterLifecycleTab === "closed"
                        ? "border-amber-300 bg-amber-50 shadow-sm ring-2 ring-amber-200/70"
                        : "border-stone-200 bg-white hover:-translate-y-0.5 hover:border-amber-200 hover:shadow-sm"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-semibold text-stone-700">已結案</div>
                      <span className="text-[10px] text-stone-400 group-hover:text-amber-600">點選</span>
                    </div>
                    <div className="mt-0.5 text-lg font-bold tabular-nums text-stone-900">{masterLifecycleCounts.closed}</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMasterLongTermFilter((prev) => (prev === "long_term_only" ? "all" : "long_term_only"))}
                    className={`group min-w-[7rem] rounded-xl border px-3 py-2 text-left text-xs transition cursor-pointer ${
                      masterLongTermFilter === "long_term_only"
                        ? "border-amber-300 bg-amber-50 shadow-sm ring-2 ring-amber-200/70"
                        : "border-stone-200 bg-white hover:-translate-y-0.5 hover:border-amber-200 hover:shadow-sm"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-semibold text-stone-700">僅長期案</div>
                      <span className="text-[10px] text-stone-400 group-hover:text-amber-600">切換</span>
                    </div>
                    <div className="mt-0.5 text-lg font-bold tabular-nums text-stone-900">{masterLongTermCounts.longTermOnly}</div>
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-stone-200/80 pt-3">
                  <span className="text-[11px] font-semibold text-stone-500">建立時間排序</span>
                  <button
                    type="button"
                    onClick={() => setMasterCreatedSortDirection("desc")}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                      masterCreatedSortDirection === "desc"
                        ? "bg-amber-500 text-slate-900 shadow-sm ring-1 ring-amber-400/80"
                        : "border border-stone-200 bg-white text-stone-600 hover:bg-amber-50"
                    }`}
                  >
                    新到舊
                  </button>
                  <button
                    type="button"
                    onClick={() => setMasterCreatedSortDirection("asc")}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                      masterCreatedSortDirection === "asc"
                        ? "bg-amber-500 text-slate-900 shadow-sm ring-1 ring-amber-400/80"
                        : "border border-stone-200 bg-white text-stone-600 hover:bg-amber-50"
                    }`}
                  >
                    舊到新
                  </button>
                </div>
                <p className="mt-2 text-[11px] text-stone-500">點選卡片可切換狀態；「僅長期案」為開關式篩選。</p>
              </div>
              {masterLifecycleTab === "closed" && (
                <p className="mt-2 max-w-3xl text-xs text-stone-500">
                  以下為已結案專案，僅供查詢與歷史紀錄；若要處理進行中工作請切換「進行中」。
                </p>
              )}
              {masterLongTermFilter === "long_term_only" && (
                <p className="mt-2 max-w-3xl text-xs text-stone-500">
                  以下為目前分頁中已標記為長期案的專案，適合定期請款追蹤。
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2 border-b border-stone-200/80 pb-3" role="tablist" aria-label="依專案類型篩選">
                {masterSubTabOptions.map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={masterSubTab === tab}
                    onClick={() => setMasterSubTab(tab)}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                      masterSubTab === tab
                        ? "bg-amber-500 text-slate-900 shadow-sm ring-1 ring-amber-400/80"
                        : "border border-transparent bg-stone-100/90 text-stone-600 hover:border-stone-200 hover:bg-amber-50/90"
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
              {masterFilteredListHasBothPayoutModes && masterSubTab === "全部" && masterTabFilteredList.length > 0 && (
                <p className="mt-2 max-w-3xl text-xs text-stone-500">
                  「全部」分頁若同時含製作/活動與廣告業配／團購專案，會顯示兩組分潤角色欄；切到單一專案類型分頁即可只顯示對應欄位。
                </p>
              )}
              {inlineStatusError && (
                <p className="mt-2 rounded-lg bg-amber-100/90 px-3 py-2 text-xs font-medium text-amber-800">{inlineStatusError}</p>
              )}
            </div>
            <div className="overflow-x-auto rounded-xl border border-stone-200/90 ring-1 ring-amber-100/60">
              <table className="min-w-full table-fixed divide-y divide-stone-200">
                <colgroup>
                  {masterColsForDisplay.map((k) => (
                    <col
                      key={k}
                      className={
                        k === "專案ID"
                          ? "w-[5rem] min-w-[5rem]"
                          : k === "專案名稱"
                            ? "min-w-[12rem]"
                            : k === "款項進度"
                              ? "min-w-[5.5rem]"
                              : k === "發票摘要"
                                ? "min-w-[11rem]"
                                : "min-w-[5rem]"
                      }
                    />
                  ))}
                </colgroup>
                <thead className="sticky top-0 z-20 bg-stone-100">
                  <tr>
                    {masterColsForDisplay.map((k) => (
                      <th
                        key={k}
                        className={
                          k === "專案ID"
                            ? "sticky left-0 z-30 w-[5rem] min-w-[5rem] max-w-[5rem] bg-stone-100 px-2 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-amber-800 whitespace-nowrap"
                            : k === "專案名稱"
                              ? "sticky left-[5rem] z-30 w-48 min-w-[12rem] max-w-[12rem] bg-stone-100 px-4 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-amber-800 whitespace-nowrap"
                              : k === "款項進度"
                                ? "min-w-[5.5rem] px-4 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-amber-800 whitespace-nowrap"
                                : k === "發票摘要"
                                  ? "min-w-[11rem] px-4 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-amber-800 whitespace-nowrap"
                                  : "min-w-[5rem] px-4 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-stone-600 whitespace-nowrap"
                        }
                      >
                        {tableColumnLabels.master?.[k] ?? k}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody
                  className={
                    masterLifecycleTab === "closed"
                      ? "divide-y divide-stone-200 bg-stone-50/50"
                      : "divide-y divide-stone-200 bg-amber-50/40"
                  }
                >
                  {filteredMasterList.length === 0 ? (
                    <tr>
                      <td colSpan={masterColsForDisplay.length || 15} className="px-4 py-8 text-center text-base font-medium text-stone-500">
                        尚無大總表資料，請點「新增專案」建立第一筆
                      </td>
                    </tr>
                  ) : masterLifecycleBaseList.length === 0 ? (
                    <tr>
                      <td colSpan={masterColsForDisplay.length || 15} className="px-4 py-8 text-center text-base font-medium text-stone-500">
                        {masterLifecycleTab === "in_progress"
                          ? "目前沒有進行中的專案。將專案狀態改為結案／完成等狀態後，該筆會出現在「已結案」。"
                          : "目前沒有已結案的專案。"}
                      </td>
                    </tr>
                  ) : masterLongTermFilteredList.length === 0 ? (
                    <tr>
                      <td colSpan={masterColsForDisplay.length || 15} className="px-4 py-8 text-center text-base font-medium text-stone-500">
                        目前分頁沒有符合「僅長期案」的專案，請切回「全部」或到專案詳情勾選「長期案」。
                      </td>
                    </tr>
                  ) : masterTabFilteredList.length === 0 ? (
                    <tr>
                      <td colSpan={masterColsForDisplay.length || 15} className="px-4 py-8 text-center text-base font-medium text-stone-500">
                        此專案類型在目前區間尚無資料，請切換上方「專案類型」或新增專案
                      </td>
                    </tr>
                  ) : searchedMasterList.length === 0 ? (
                    <tr>
                      <td colSpan={masterColsForDisplay.length || 15} className="px-4 py-8 text-center text-base font-medium text-stone-500">
                        沒有符合搜尋結果
                      </td>
                    </tr>
                  ) : (
                    visibleMasterRows.map((row) => {
                      const pid = row.專案ID ?? "";
                      const isExpanded = expandedProjectId === pid;
                      // 大總表展開列：該專案任務全顯（不套用任務②可見規則）；側邊「任務」分頁仍為 filteredTasks
                      const projectTasks = tasks.filter((t) => (t.專案ID ?? "").trim().toLowerCase() === pid.trim().toLowerCase());
                      const invoiceSummary = invoiceSummaryByProjectId.get(String(pid).trim());
                      const projectInvoices = invoiceSummary?.rows ?? [];
                      const projectFinance = financeByProjectId.get(String(pid).trim());
                      const financeProgress = financeProgressShortLabel(projectFinance);
                      const financeProgressInfo = financeProgressDetail(projectFinance);
                      return (
                        <Fragment key={row.id ?? pid}>
                          <tr
                            key={row.id ?? pid}
                            className={`cursor-pointer transition ${
                              masterLifecycleTab === "closed" ? "hover:bg-stone-100/85" : "hover:bg-amber-50/80"
                            }`}
                            onClick={() => {
                              setSelectedMaster(row);
                              setIsEditingMaster(false);
                              setSaveMasterError(null);
                            }}
                          >
                            {masterColsForDisplay.map((k) => {
                              const amountKeys = ["專案總金額未稅", "專案營收", "專案成本", "KOL費用未稅"];
                              const isAmount = amountKeys.includes(k);
                              const val = (row as unknown as Record<string, unknown>)[k];
                              const modeBRow = isPayoutModeB(String(row.專案類型 ?? ""));
                              const wrongModeRoleCol =
                                (modeBRow && MASTER_PAYOUT_MODE_A_COL_KEYS.has(k)) ||
                                (!modeBRow && MASTER_PAYOUT_MODE_B_COL_KEYS.has(k));
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
                                        setNewTaskForm({ 任務名稱: "", 任務類型: "", 任務負責人: "", 到期日: "", 備註: "" });
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
                              if (k === "款項進度") {
                                const fpid = String(row.專案ID ?? "").trim();
                                const fr = fpid ? financeByProjectId.get(fpid) : undefined;
                                const short = financeProgressShortLabel(fr);
                                const detail = financeProgressDetail(fr);
                                return (
                                  <td key={k} className="whitespace-nowrap bg-white/90 px-4 py-3.5" title={detail}>
                                    <span
                                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${financeProgressBadgeClass(short)}`}
                                    >
                                      {short}
                                    </span>
                                  </td>
                                );
                              }
                              if (k === "發票摘要") {
                                const summary = invoiceSummary ?? buildInvoiceSummary([]);
                                const hasInvoices = summary.count > 0;
                                const badgeClass =
                                  summary.status === "已收款"
                                    ? "bg-emerald-100 text-emerald-800"
                                    : summary.status === "部分收款"
                                      ? "bg-amber-100 text-amber-800"
                                      : summary.status === "已開票未收"
                                        ? "bg-orange-100 text-orange-800"
                                        : "bg-stone-100 text-stone-500";
                                return (
                                  <td key={k} className="whitespace-nowrap bg-white/90 px-4 py-2.5 text-xs text-stone-600">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (!hasInvoices) return;
                                        setExpandedProjectId((prev) => (prev === pid ? null : pid));
                                      }}
                                      disabled={!hasInvoices}
                                      className="group rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-left shadow-sm transition hover:border-amber-300 hover:bg-amber-50 disabled:cursor-default disabled:bg-stone-50 disabled:shadow-none"
                                      title={hasInvoices ? "展開查看此專案發票明細" : "此專案尚無對應發票"}
                                    >
                                      <span className={`mb-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${badgeClass}`}>
                                        {summary.status}
                                      </span>
                                      <span className="block font-semibold text-stone-800">
                                        {hasInvoices ? `${summary.count} 張 / ${formatAmount(String(Math.round(summary.totalAmount)))}` : "尚無發票"}
                                      </span>
                                      {hasInvoices && (
                                        <span className="block text-[10px] text-stone-500">
                                          已收 {formatAmount(String(Math.round(summary.paidAmount)))} · 未收 {formatAmount(String(Math.round(summary.unpaidAmount)))}
                                        </span>
                                      )}
                                    </button>
                                  </td>
                                );
                              }
                              if (k === "專案狀態") {
                                const rowId = String(row.id ?? "").trim();
                                const current = String(row.專案狀態 ?? "");
                                const statusOptions = [...new Set([...projectStatusOptions, current].filter(Boolean))];
                                if (!canUpdateMaster) {
                                  return (
                                    <td key={k} className="whitespace-nowrap px-4 py-3.5 text-sm font-medium text-stone-600">
                                      {current || "—"}
                                    </td>
                                  );
                                }
                                return (
                                  <td
                                    key={k}
                                    className="whitespace-nowrap px-4 py-2.5 text-sm font-medium text-stone-600"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <select
                                      value={current}
                                      disabled={inlineStatusSavingId === rowId}
                                      onChange={(e) => {
                                        void updateProjectStatusInline(row, e.target.value);
                                      }}
                                      className="w-full min-w-[7rem] rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-sm text-stone-700 focus:border-amber-500/60 focus:outline-none disabled:opacity-60"
                                      title={current || "未設定"}
                                    >
                                      <option value="">未設定</option>
                                      {statusOptions.map((s) => (
                                        <option key={s} value={s}>
                                          {s}
                                        </option>
                                      ))}
                                    </select>
                                  </td>
                                );
                              }
                              const cellText = masterTableCellText(row, k, partnerByKolName, financeByProjectId);
                              const displayStr = cellText || "—";
                              return (
                                <td
                                  key={k}
                                  className={`whitespace-nowrap px-4 py-3.5 text-sm font-medium ${wrongModeRoleCol ? "text-stone-400" : "text-stone-600"} ${isAmount ? "tabular-nums" : ""}`}
                                >
                                  {isAmount ? formatAmount(cellText) : displayStr}
                                </td>
                              );
                            })}
                          </tr>
                          {isExpanded && (
                            <tr key={`${pid}-tasks`}>
                              <td colSpan={masterColsForDisplay.length || 15} className="border-t-0 bg-stone-50 px-4 py-4">
                                <div className="rounded-xl border border-stone-200/90 bg-stone-50/90 p-4">
                                  <div className="mb-4 rounded-lg border border-stone-200 bg-white/90 p-3">
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                      <div>
                                        <h3 className="text-sm font-bold uppercase tracking-wider text-stone-700">款項進度</h3>
                                        <p className="mt-1 text-xs text-stone-500">{financeProgressInfo}</p>
                                      </div>
                                      <div className="flex flex-wrap items-center gap-2 text-xs">
                                        <span className={`rounded-full px-2.5 py-0.5 font-semibold ${financeProgressBadgeClass(financeProgress)}`}>
                                          {financeProgress}
                                        </span>
                                        <span className="text-stone-500">
                                          廠商付款：{projectFinance?.廠商付款日期 || "—"}
                                        </span>
                                        <span className="text-stone-500">
                                          員工分潤：{projectFinance?.員工分潤日期 || "—"}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                  <h3 className="mb-3 text-sm font-bold uppercase tracking-wider text-amber-800">此專案任務</h3>
                                  <div className="mb-4 max-w-full overflow-x-auto rounded-lg border border-stone-200/90">
                                    {/*
                                      inline-table：避免在整欄寬的 td 內被撐成 100% 寬（與上方專案列無對齊需求）
                                    */}
                                    <table className="inline-table max-w-full align-top border-collapse divide-y divide-stone-200">
                                      <thead className="bg-amber-100/80">
                                        <tr>
                                          <th className="w-[10rem] max-w-[11rem] px-3 py-2 text-left text-xs font-semibold uppercase text-stone-500">
                                            任務
                                          </th>
                                          <th className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase text-stone-500">
                                            任務類型
                                          </th>
                                          <th className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase text-stone-500">
                                            任務負責人
                                          </th>
                                          <th className="max-w-[10rem] px-3 py-2 text-left text-xs font-semibold uppercase text-stone-500">
                                            備註
                                          </th>
                                          <th className="whitespace-nowrap px-3 py-2 text-center text-xs font-semibold uppercase text-stone-500">
                                            到期日
                                          </th>
                                          <th className="whitespace-nowrap px-3 py-2 text-center text-xs font-semibold uppercase text-stone-500">
                                            開始時間
                                          </th>
                                          <th className="whitespace-nowrap px-3 py-2 text-center text-xs font-semibold uppercase text-stone-500">
                                            完成時間
                                          </th>
                                          <th className="w-12 min-w-[2.75rem] whitespace-nowrap px-2 py-2 text-center text-xs font-semibold uppercase text-stone-500">
                                            完成
                                          </th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-stone-200 bg-white/90">
                                        {projectTasks.length === 0 ? (
                                          <tr>
                                            <td colSpan={8} className="px-3 py-4 text-center text-sm text-stone-500">
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
                                              <td
                                                className="w-[10rem] max-w-[11rem] px-3 py-2.5 text-sm text-stone-900 align-top"
                                                title={t.任務 ? String(t.任務) : undefined}
                                              >
                                                <span className="line-clamp-2 break-words">{t.任務 ?? "—"}</span>
                                              </td>
                                              <td className="whitespace-nowrap px-3 py-2.5 text-sm text-stone-600">{t.任務類型 ?? "—"}</td>
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
                                              <td className="max-w-[10rem] px-3 py-2.5 text-xs text-stone-600 align-top">
                                                <span className="line-clamp-3 break-words" title={t.備註 ? String(t.備註) : undefined}>
                                                  {t.備註?.trim() ? t.備註 : "—"}
                                                </span>
                                              </td>
                                              <td
                                                className="whitespace-nowrap px-3 py-2.5 text-center text-xs tabular-nums align-top"
                                                onClick={(ev) => ev.stopPropagation()}
                                              >
                                                <input
                                                  type="date"
                                                  value={t.到期日?.trim() ? t.到期日.trim().slice(0, 10) : ""}
                                                  onChange={async (ev) => {
                                                    if (!t.任務ID) return;
                                                    const v = ev.target.value.trim();
                                                    try {
                                                      const res = await fetch("/api/tasks", {
                                                        method: "PATCH",
                                                        headers: { "Content-Type": "application/json" },
                                                        body: JSON.stringify({
                                                          任務ID: t.任務ID,
                                                          到期日: v || null,
                                                        }),
                                                      });
                                                      const data = (await safeResJson(res)) as { ok?: boolean; task?: TaskRow };
                                                      if (res.ok && data.ok && data.task) {
                                                        setTasks((prev) => prev.map((x) => (x.任務ID === t.任務ID ? data.task! : x)));
                                                      }
                                                    } catch {
                                                      /* 忽略 */
                                                    }
                                                  }}
                                                  className={`max-w-[9.5rem] rounded border px-1.5 py-1 text-xs ${
                                                    getTaskDueUiStatus(t.任務完成, t.到期日) === "overdue"
                                                      ? "border-red-300 bg-red-50 text-red-900"
                                                      : getTaskDueUiStatus(t.任務完成, t.到期日) === "soon"
                                                        ? "border-amber-300 bg-amber-50 text-amber-900"
                                                        : "border-stone-200 bg-white text-stone-800"
                                                  }`}
                                                  title="在此設定到期日；點列其餘處可開啟完整編輯"
                                                />
                                              </td>
                                              <td className="whitespace-nowrap px-3 py-2.5 text-center text-xs tabular-nums text-stone-600">
                                                {formatTaskDisplayTime(t.開始時間)}
                                              </td>
                                              <td className="whitespace-nowrap px-3 py-2.5 text-center text-xs tabular-nums text-stone-600">
                                                {formatTaskDisplayTime(t.完成時間)}
                                              </td>
                                              <td className="w-12 min-w-[2.75rem] px-2 py-2.5 text-center align-middle">
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
                                                  className={`mx-auto inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded border-2 transition hover:border-amber-400/70 hover:bg-amber-50 ${
                                                    t.任務完成
                                                      ? "border-amber-500/60 bg-amber-500/15"
                                                      : "border-stone-300 bg-white shadow-sm"
                                                  }`}
                                                  title={t.任務完成 ? "點擊取消完成" : "點擊標記完成"}
                                                  aria-checked={t.任務完成}
                                                  role="checkbox"
                                                >
                                                  {t.任務完成 ? (
                                                    <span className="text-sm font-semibold text-amber-800" aria-hidden>
                                                      ✓
                                                    </span>
                                                  ) : (
                                                    <span className="sr-only">未完成</span>
                                                  )}
                                                </button>
                                              </td>
                                            </tr>
                                          ))
                                        )}
                                      </tbody>
                                    </table>
                                  </div>
                                  <div className="mb-4 rounded-lg border border-emerald-100 bg-white/90 p-3">
                                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                      <h3 className="text-sm font-bold uppercase tracking-wider text-emerald-800">此專案發票</h3>
                                      {invoiceSummary && invoiceSummary.count > 0 && (
                                        <p className="text-xs text-stone-500">
                                          共 {invoiceSummary.count} 張，含稅合計 {formatAmount(String(Math.round(invoiceSummary.totalAmount)))}，
                                          已收 {formatAmount(String(Math.round(invoiceSummary.paidAmount)))}，
                                          未收 {formatAmount(String(Math.round(invoiceSummary.unpaidAmount)))}
                                        </p>
                                      )}
                                    </div>
                                    {projectInvoices.length === 0 ? (
                                      <p className="rounded-lg bg-stone-50 px-3 py-3 text-sm text-stone-500">
                                        尚無對應發票。可到「財務 / 發票清冊」將發票的對應專案設為此專案ID。
                                      </p>
                                    ) : (
                                      <div className="max-w-full overflow-x-auto rounded-lg border border-stone-200/90">
                                        <table className="min-w-full divide-y divide-stone-200 text-xs">
                                          <thead className="bg-emerald-50">
                                            <tr>
                                              <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-stone-600">發票號碼</th>
                                              <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-stone-600">發票日期</th>
                                              <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-stone-600">收款對象</th>
                                              <th className="whitespace-nowrap px-3 py-2 text-right font-semibold text-stone-600">含稅金額</th>
                                              <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-stone-600">預計付款日</th>
                                              <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-stone-600">付款日期</th>
                                              <th className="min-w-[10rem] px-3 py-2 text-left font-semibold text-stone-600">備註</th>
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-stone-100 bg-white">
                                            {projectInvoices.map((invoice, idx) => (
                                              <tr key={invoice.id ?? `${pid}-invoice-${idx}`} className="hover:bg-emerald-50/50">
                                                <td className="whitespace-nowrap px-3 py-2 font-medium text-stone-800">{invoice.發票號碼 || "—"}</td>
                                                <td className="whitespace-nowrap px-3 py-2 text-stone-600">{invoice.發票日期 || "—"}</td>
                                                <td className="whitespace-nowrap px-3 py-2 text-stone-600">{invoice.收款對象 || "—"}</td>
                                                <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums text-stone-800">
                                                  {formatAmount(invoice.發票金額含稅)}
                                                </td>
                                                <td className="whitespace-nowrap px-3 py-2 text-stone-600">{invoice.廠商預計付款日 || "—"}</td>
                                                <td className="whitespace-nowrap px-3 py-2 text-stone-600">
                                                  {invoice.廠商付款日期 ? (
                                                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800">
                                                      {invoice.廠商付款日期}
                                                    </span>
                                                  ) : (
                                                    <span className="rounded-full bg-orange-100 px-2 py-0.5 font-semibold text-orange-800">未收</span>
                                                  )}
                                                </td>
                                                <td className="max-w-[16rem] px-3 py-2 text-stone-600">
                                                  <span className="line-clamp-2 break-words">{invoice.備註 || "—"}</span>
                                                </td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    )}
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
                                              任務類型: newTaskForm.任務類型.trim() || null,
                                              負責人: newTaskForm.任務負責人.trim() || null,
                                              備註: newTaskForm.備註.trim() || null,
                                              到期日: newTaskForm.到期日.trim() || null,
                                            }),
                                          });
                                          const data = (await safeResJson(res)) as { ok?: boolean; error?: string; task?: TaskRow };
                                          if (!res.ok || !data.ok) {
                                            setAddTaskError(data.error ?? "新增失敗");
                                            setAddingTask(false);
                                            return;
                                          }
                                          setTasks((prev) => [data.task!, ...prev]);
                                          setNewTaskForm({ 任務名稱: "", 任務類型: "", 任務負責人: "", 到期日: "", 備註: "" });
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
                                        <label className="mb-1 block text-xs font-semibold text-stone-500">任務類型</label>
                                        <select
                                          value={newTaskForm.任務類型}
                                          onChange={(e) => setNewTaskForm((f) => ({ ...f, 任務類型: e.target.value }))}
                                          className="min-w-[8rem] rounded-lg border border-stone-300 bg-stone-100 px-3 py-2 text-sm text-stone-900 focus:border-amber-400/70 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
                                        >
                                          <option value="">—</option>
                                          {taskTypeOptions.map((o) => (
                                            <option key={o} value={o}>
                                              {o}
                                            </option>
                                          ))}
                                        </select>
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
                                      <div>
                                        <label className="mb-1 block text-xs font-semibold text-stone-500">到期日</label>
                                        <input
                                          type="date"
                                          value={newTaskForm.到期日}
                                          onChange={(e) => setNewTaskForm((f) => ({ ...f, 到期日: e.target.value }))}
                                          className="w-44 rounded-lg border border-stone-300 bg-stone-100 px-3 py-2 text-sm text-stone-900 focus:border-amber-400/70 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
                                        />
                                      </div>
                                      <div className="w-full basis-full">
                                        <label className="mb-1 block text-xs font-semibold text-stone-500">備註</label>
                                        <textarea
                                          value={newTaskForm.備註}
                                          onChange={(e) => setNewTaskForm((f) => ({ ...f, 備註: e.target.value }))}
                                          rows={2}
                                          className="w-full min-w-[min(100%,20rem)] rounded-lg border border-stone-300 bg-stone-100 px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-400/70 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
                                          placeholder="選填"
                                        />
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
                                            setNewTaskForm({ 任務名稱: "", 任務類型: "", 任務負責人: "", 到期日: "", 備註: "" });
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
                                        setNewTaskForm({ 任務名稱: "", 任務類型: "", 任務負責人: "", 到期日: "", 備註: "" });
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
          <section id="dashboard-system-settings" className="scroll-mt-6 rounded-2xl border border-stone-200/90 bg-white/90 p-6 shadow-xl ring-1 ring-amber-100/60">
            <h2 className="mb-1 text-xl font-bold tracking-tight text-stone-900">系統設定</h2>
            <p className="mb-4 text-sm text-stone-500">分潤成數、專案類型、專案狀態等，修改後點擊儲存即可生效</p>

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
                      {(["專案開發人分潤成數", "經紀人分潤成數", "主管分潤成數", "KOL開發者分潤成數"] as const).map((k) => (
                        <div key={k} className="flex items-center gap-2">
                          <span className="text-xs text-stone-500">{MASTER_PAYOUT_MODE_B_CONFIG_LABELS[k] ?? k}</span>
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
                    label: "模式 B（廣告業配、團購）",
                    roles: ["專案開發人", "經紀人", "主管", "KOL開發者"] as const,
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

              {/* 專案狀態選項（大總表「專案狀態」下拉） */}
              <div className="rounded-xl border border-stone-200/90 bg-stone-50/90 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-semibold text-amber-800">專案狀態選項</h3>
                  <button
                    type="button"
                    disabled={savingConfig === "project_status_options"}
                    onClick={async () => {
                      setSavingConfig("project_status_options");
                      try {
                        const res = await fetch("/api/system-config", {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ key: "project_status_options", value: projectStatusOptions }),
                        });
                        const data = (await safeResJson(res)) as { ok?: boolean; config?: { project_status_options?: string[] } };
                        if (res.ok && data.ok && data.config) {
                          setSystemConfig((c) => (c ? { ...c, project_status_options: data.config!.project_status_options } : null));
                          await refreshDashboardData(["systemConfig", "master"]);
                        }
                      } catch {
                        /* ignore */
                      }
                      setSavingConfig(null);
                    }}
                    className="rounded-lg bg-amber-100/90 px-3 py-1.5 text-xs font-bold text-amber-800 transition hover:bg-amber-200/60 disabled:opacity-60"
                  >
                    {savingConfig === "project_status_options" ? "儲存中" : "儲存"}
                  </button>
                </div>
                <p className="mb-3 text-xs text-stone-500">
                  新增／編輯大總表時「專案狀態」的下拉選項。存於 <code className="rounded bg-stone-200/80 px-1 py-0.5 text-[10px]">system_config.project_status_options</code>
                </p>
                <div className="flex flex-wrap gap-2">
                  {projectStatusOptions.map((s, i) => (
                    <span key={`${s}-${i}`} className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-600">
                      {s}
                      <button
                        type="button"
                        onClick={() =>
                          setSystemConfig((c) => ({
                            ...(c ?? {
                              master_payout_defaults: { ...MASTER_PAYOUT_DEFAULTS },
                              project_types: [...PROJECT_TYPES],
                              role_visibility: {},
                            }),
                            project_status_options: projectStatusOptions.filter((_, j) => j !== i),
                          }))
                        }
                        className="text-stone-500 hover:text-amber-800"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <input
                    type="text"
                    placeholder="+ 新增狀態"
                    className="w-28 rounded border border-dashed border-stone-300 bg-transparent px-2 py-1 text-xs text-stone-500 placeholder:text-stone-400 focus:border-amber-400/70 focus:outline-none"
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      const v = (e.target as HTMLInputElement).value.trim();
                      if (v && !projectStatusOptions.includes(v)) {
                        setSystemConfig((c) => ({
                          ...(c ?? {
                            master_payout_defaults: { ...MASTER_PAYOUT_DEFAULTS },
                            project_types: [...PROJECT_TYPES],
                            role_visibility: {},
                          }),
                          project_status_options: [...projectStatusOptions, v],
                        }));
                        (e.target as HTMLInputElement).value = "";
                      }
                    }}
                  />
                </div>
              </div>

              {/* 專案費用類型選項（大總表「專案費用類型」下拉） */}
              <div className="rounded-xl border border-stone-200/90 bg-stone-50/90 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-semibold text-amber-800">專案費用類型選項</h3>
                  <button
                    type="button"
                    disabled={savingConfig === "project_expense_type_options"}
                    onClick={async () => {
                      setSavingConfig("project_expense_type_options");
                      try {
                        const res = await fetch("/api/system-config", {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ key: "project_expense_type_options", value: projectExpenseTypeOptions }),
                        });
                        const data = (await safeResJson(res)) as {
                          ok?: boolean;
                          config?: { project_expense_type_options?: string[] };
                        };
                        if (res.ok && data.ok && data.config) {
                          setSystemConfig((c) =>
                            c ? { ...c, project_expense_type_options: data.config!.project_expense_type_options } : null
                          );
                          await refreshDashboardData(["systemConfig", "master"]);
                        }
                      } catch {
                        /* ignore */
                      }
                      setSavingConfig(null);
                    }}
                    className="rounded-lg bg-amber-100/90 px-3 py-1.5 text-xs font-bold text-amber-800 transition hover:bg-amber-200/60 disabled:opacity-60"
                  >
                    {savingConfig === "project_expense_type_options" ? "儲存中" : "儲存"}
                  </button>
                </div>
                <p className="mb-3 text-xs text-stone-500">
                  新增／編輯大總表時「專案費用類型」的下拉選項。存於{" "}
                  <code className="rounded bg-stone-200/80 px-1 py-0.5 text-[10px]">system_config.project_expense_type_options</code>
                </p>
                <div className="flex flex-wrap gap-2">
                  {projectExpenseTypeOptions.map((s, i) => (
                    <span key={`${s}-${i}`} className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-600">
                      {s}
                      <button
                        type="button"
                        onClick={() =>
                          setSystemConfig((c) => ({
                            ...(c ?? {
                              master_payout_defaults: { ...MASTER_PAYOUT_DEFAULTS },
                              project_types: [...PROJECT_TYPES],
                              role_visibility: {},
                            }),
                            project_expense_type_options: projectExpenseTypeOptions.filter((_, j) => j !== i),
                          }))
                        }
                        className="text-stone-500 hover:text-amber-800"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <input
                    type="text"
                    placeholder="+ 新增類型"
                    className="w-28 rounded border border-dashed border-stone-300 bg-transparent px-2 py-1 text-xs text-stone-500 placeholder:text-stone-400 focus:border-amber-400/70 focus:outline-none"
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      const v = (e.target as HTMLInputElement).value.trim();
                      if (v && !projectExpenseTypeOptions.includes(v)) {
                        setSystemConfig((c) => ({
                          ...(c ?? {
                            master_payout_defaults: { ...MASTER_PAYOUT_DEFAULTS },
                            project_types: [...PROJECT_TYPES],
                            role_visibility: {},
                          }),
                          project_expense_type_options: [...projectExpenseTypeOptions, v],
                        }));
                        (e.target as HTMLInputElement).value = "";
                      }
                    }}
                  />
                </div>
              </div>

              {/* 任務類型選項（任務表「任務類型」下拉） */}
              <div className="rounded-xl border border-stone-200/90 bg-stone-50/90 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-semibold text-amber-800">任務類型選項</h3>
                  <button
                    type="button"
                    disabled={savingConfig === "task_type_options"}
                    onClick={async () => {
                      setSavingConfig("task_type_options");
                      try {
                        const res = await fetch("/api/system-config", {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ key: "task_type_options", value: taskTypeOptions }),
                        });
                        const data = (await safeResJson(res)) as { ok?: boolean; config?: { task_type_options?: string[] } };
                        if (res.ok && data.ok && data.config) {
                          setSystemConfig((c) => (c ? { ...c, task_type_options: data.config!.task_type_options } : null));
                          await refreshDashboardData(["systemConfig"]);
                        }
                      } catch {
                        /* ignore */
                      }
                      setSavingConfig(null);
                    }}
                    className="rounded-lg bg-amber-100/90 px-3 py-1.5 text-xs font-bold text-amber-800 transition hover:bg-amber-200/60 disabled:opacity-60"
                  >
                    {savingConfig === "task_type_options" ? "儲存中" : "儲存"}
                  </button>
                </div>
                <p className="mb-3 text-xs text-stone-500">任務列表「任務類型」欄的下拉選項；可自訂分類名稱。</p>
                <div className="flex flex-wrap gap-2">
                  {taskTypeOptions.map((s, i) => (
                    <span key={`${s}-${i}`} className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-600">
                      {s}
                      <button
                        type="button"
                        onClick={() =>
                          setSystemConfig((c) => ({
                            ...(c ?? {
                              master_payout_defaults: { ...MASTER_PAYOUT_DEFAULTS },
                              project_types: [...PROJECT_TYPES],
                              role_visibility: {},
                            }),
                            task_type_options: taskTypeOptions.filter((_, j) => j !== i),
                          }))
                        }
                        className="text-stone-500 hover:text-amber-800"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <input
                    type="text"
                    placeholder="+ 新增類型"
                    className="w-28 rounded border border-dashed border-stone-300 bg-transparent px-2 py-1 text-xs text-stone-500 placeholder:text-stone-400 focus:border-amber-400/70 focus:outline-none"
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      const v = (e.target as HTMLInputElement).value.trim();
                      if (v && !taskTypeOptions.includes(v)) {
                        setSystemConfig((c) => ({
                          ...(c ?? {
                            master_payout_defaults: { ...MASTER_PAYOUT_DEFAULTS },
                            project_types: [...PROJECT_TYPES],
                            role_visibility: {},
                          }),
                          task_type_options: [...taskTypeOptions, v],
                        }));
                        (e.target as HTMLInputElement).value = "";
                      }
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
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-stone-900/30 backdrop-blur-sm p-4">
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
                  className="relative z-[25]"
                  label="角色"
                  value={displayRoles.includes(createUserForm.role) ? createUserForm.role : (displayRoles[0] ?? "經紀人")}
                  onChange={(v) => setCreateUserForm((f) => ({ ...f, role: v }))}
                  options={[...displayRoles]}
                />
                <div>
                  <InputField label="部門（選填）" value={createUserForm.dept} onChange={(v) => setCreateUserForm((f) => ({ ...f, dept: v }))} />
                  <p className="mt-1 text-xs leading-relaxed text-stone-500">
                    內部備註用（例如業務組），可留空。這裡不是「職位選單」：職位請改上面「角色」。
                  </p>
                </div>
                {createUserForm.role === "KOL" ? (
                  <div>
                    <SearchableSelectField
                      label="責任範圍：綁定合作夥伴 (PartnerID)"
                      value={kolScopeButtonLabel(createUserForm.scope, kolPartnerScopeOptions)}
                      onChange={(v) =>
                        setCreateUserForm((f) => ({ ...f, scope: v ? parseKolPartnerOptionToScope(v) : "" }))
                      }
                      options={kolPartnerScopeOptions}
                      searchPlaceholder="搜尋編號或 KOL 名稱…"
                      emptyHint="尚無合作夥伴時請先到「合作夥伴」新增（核准後才會出現）"
                    />
                    <p className="mt-1 text-xs leading-relaxed text-stone-500">
                      選填：選取後會寫入 PartnerID，用來對應專案。若不選，則以登入 Email 與合作夥伴表的 Email 一致時仍可對應。
                    </p>
                  </div>
                ) : (
                  <div>
                    <InputField label="責任範圍 (scope)" value={createUserForm.scope} onChange={(v) => setCreateUserForm((f) => ({ ...f, scope: v }))} />
                    <p className="mt-1 text-xs leading-relaxed text-stone-500">
                      經紀人常見：<span className="font-mono text-stone-600">主管</span>、<span className="font-mono text-stone-600">*</span> 或留空（依公司規範）。
                    </p>
                  </div>
                )}
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
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-stone-900/30 backdrop-blur-sm p-4">
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
                    <label className="mb-1 block text-xs font-semibold text-stone-500">
                      KOL開發者{!canEditVisibility && "— 僅董事長／管理者可指定"}
                    </label>
                    {canEditVisibility ? (
                      <input
                        type="text"
                        value={createPartnerForm.KOL開發者}
                        onChange={(e) => setCreatePartnerForm((f) => ({ ...f, KOL開發者: e.target.value }))}
                        placeholder="可輸入內部或外部人員名稱"
                        className="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-1.5 text-sm text-stone-900"
                      />
                    ) : (
                      <p className="rounded-lg border border-stone-200/90 bg-stone-50 px-3 py-1.5 text-sm text-stone-500">
                        核准後由董事長指定
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-stone-500">經銷約開始日</label>
                    <input
                      type="date"
                      value={toHtmlDateValue(createPartnerForm.經銷約開始日)}
                      onChange={(e) => setCreatePartnerForm((f) => ({ ...f, 經銷約開始日: e.target.value }))}
                      className="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-1.5 text-sm text-stone-900"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-stone-500">經銷約結束日</label>
                    <input
                      type="date"
                      value={toHtmlDateValue(createPartnerForm.經銷約結束日)}
                      onChange={(e) => setCreatePartnerForm((f) => ({ ...f, 經銷約結束日: e.target.value }))}
                      className="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-1.5 text-sm text-stone-900"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-stone-500">自來件分潤%數</label>
                    <input
                      type="text"
                      placeholder="例：20%"
                      value={createPartnerForm.自來件分潤}
                      onChange={(e) => setCreatePartnerForm((f) => ({ ...f, 自來件分潤: e.target.value }))}
                      className="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-1.5 text-sm text-stone-900"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-stone-500">SDH開發件分潤%數</label>
                    <input
                      type="text"
                      placeholder="例：20%"
                      value={createPartnerForm["SDH開發分件分潤"]}
                      onChange={(e) => setCreatePartnerForm((f) => ({ ...f, "SDH開發分件分潤": e.target.value }))}
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
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-stone-900/30 backdrop-blur-sm p-4">
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
                    <label className="mb-1 block text-xs font-semibold text-stone-500">
                      KOL開發者{!canEditVisibility && "— 僅董事長可改"}
                    </label>
                    {partnerFieldEditable("KOL開發者") ? (
                      <input
                        type="text"
                        value={editPartnerForm.KOL開發者}
                        onChange={(e) => setEditPartnerForm((f) => ({ ...f, KOL開發者: e.target.value }))}
                        placeholder="可輸入內部或外部人員名稱"
                        className="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-1.5 text-sm text-stone-900"
                      />
                    ) : (
                      <p className="rounded-lg border border-stone-200/90 bg-stone-50 px-3 py-1.5 text-sm text-stone-700">{editPartnerForm.KOL開發者 || "—"}</p>
                    )}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-stone-500">經銷約開始日</label>
                    {partnerFieldEditable("經銷約開始日") ? (
                      <>
                        <input
                          type="date"
                          value={toHtmlDateValue(editPartnerForm.經銷約開始日)}
                          onChange={(e) => setEditPartnerForm((f) => ({ ...f, 經銷約開始日: e.target.value }))}
                          className="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-1.5 text-sm text-stone-900"
                        />
                        {editPartnerForm.經銷約開始日.trim() !== "" && !toHtmlDateValue(editPartnerForm.經銷約開始日) && (
                          <p className="mt-1 text-[10px] text-amber-800">原紀錄（非標準日期）：{editPartnerForm.經銷約開始日}</p>
                        )}
                      </>
                    ) : (
                      <p className="rounded-lg border border-stone-200/90 bg-stone-50 px-3 py-1.5 text-sm text-stone-700">
                        {formatPartnerDateDisplay(editPartnerForm.經銷約開始日)}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-stone-500">經銷約結束日</label>
                    {partnerFieldEditable("經銷約結束日") ? (
                      <>
                        <input
                          type="date"
                          value={toHtmlDateValue(editPartnerForm.經銷約結束日)}
                          onChange={(e) => setEditPartnerForm((f) => ({ ...f, 經銷約結束日: e.target.value }))}
                          className="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-1.5 text-sm text-stone-900"
                        />
                        {editPartnerForm.經銷約結束日.trim() !== "" && !toHtmlDateValue(editPartnerForm.經銷約結束日) && (
                          <p className="mt-1 text-[10px] text-amber-800">原紀錄（非標準日期）：{editPartnerForm.經銷約結束日}</p>
                        )}
                      </>
                    ) : (
                      <p className="rounded-lg border border-stone-200/90 bg-stone-50 px-3 py-1.5 text-sm text-stone-700">
                        {formatPartnerDateDisplay(editPartnerForm.經銷約結束日)}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-stone-500">自來件分潤%數</label>
                    {partnerFieldEditable("自來件分潤") ? (
                      <input
                        type="text"
                        placeholder="例：20%"
                        value={editPartnerForm.自來件分潤}
                        onChange={(e) => setEditPartnerForm((f) => ({ ...f, 自來件分潤: e.target.value }))}
                        className="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-1.5 text-sm text-stone-900"
                      />
                    ) : (
                      <p className="rounded-lg border border-stone-200/90 bg-stone-50 px-3 py-1.5 text-sm text-stone-700">{editPartnerForm.自來件分潤 || "—"}</p>
                    )}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-stone-500">SDH開發件分潤%數</label>
                    {partnerFieldEditable("SDH開發分件分潤") ? (
                      <input
                        type="text"
                        placeholder="例：20%"
                        value={editPartnerForm["SDH開發分件分潤"]}
                        onChange={(e) => setEditPartnerForm((f) => ({ ...f, "SDH開發分件分潤": e.target.value }))}
                        className="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-1.5 text-sm text-stone-900"
                      />
                    ) : (
                      <p className="rounded-lg border border-stone-200/90 bg-stone-50 px-3 py-1.5 text-sm text-stone-700">{editPartnerForm["SDH開發分件分潤"] || "—"}</p>
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
                            KOL開發者: editPartnerForm.KOL開發者 || undefined,
                            經銷約開始日: editPartnerForm.經銷約開始日 || undefined,
                            自來件分潤: editPartnerForm.自來件分潤 || undefined,
                            "SDH開發分件分潤": editPartnerForm["SDH開發分件分潤"] || undefined,
                            經銷約結束日: editPartnerForm.經銷約結束日 || undefined,
                            廣告經銷夥伴: editPartnerForm.廣告經銷夥伴,
                            節目製作夥伴: editPartnerForm.節目製作夥伴,
                            課程製作夥伴: editPartnerForm.課程製作夥伴,
                            Email: editPartnerForm.Email || undefined,
                            分級: editPartnerForm.分級 || undefined,
                        };
                        // 非管理者不可改 KOL開發者：不送該欄位，API 亦會過濾
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
                      await refreshDashboardData(["users"]);
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
                        KOL開發者: "",
                        經銷約開始日: "",
                        自來件分潤: "",
                        "SDH開發分件分潤": "",
                        經銷約結束日: "",
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
                            KOL開發者: String(pt.KOL開發者 ?? ""),
                            經銷約開始日: String(pt.經銷約開始日 ?? ""),
                            自來件分潤: String(pt.自來件分潤 ?? ""),
                            "SDH開發分件分潤": String(pt["SDH開發分件分潤"] ?? ""),
                            經銷約結束日: String(pt.經銷約結束日 ?? ""),
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
                              className={`px-4 py-3.5 text-sm font-medium ${k === "PartnerID" || k === "合作夥伴名稱" ? "whitespace-nowrap text-stone-900" : "text-stone-600"} ${k === "Email" || k === "頻道｜節目名稱" ? "max-w-[220px] truncate" : ""}`}
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
                            <div className="rounded-xl border border-amber-200/70 bg-gradient-to-b from-amber-50/50 to-white px-5 py-4 shadow-sm ring-1 ring-amber-100/50">
                              {PARTNER_EXPAND_SECTION_KEYS.map((section, sectionIdx) => (
                                <div
                                  key={section.title}
                                  className={
                                    sectionIdx > 0
                                      ? "mt-5 border-t border-dotted border-amber-200/90 pt-5"
                                      : undefined
                                  }
                                >
                                  <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-amber-900/80">
                                    {section.title}
                                  </p>
                                  <dl className="grid gap-x-6 gap-y-3.5 sm:grid-cols-2 lg:grid-cols-3">
                                    {section.keys.map((key) => {
                                      const val = (pt as unknown as Record<string, unknown>)[key];
                                      const label = tableColumnLabels.partners?.[key] ?? key;
                                      const isBool =
                                        key === "是否有經營 私域群" ||
                                        key === "廣告經銷夥伴" ||
                                        key === "節目製作夥伴" ||
                                        key === "課程製作夥伴";
                                      if (key === "社群網站") {
                                        return (
                                          <div key={key} className="sm:col-span-2 lg:col-span-3">
                                            <dt className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">{label}</dt>
                                            <dd className="mt-1">
                                              <SocialLinkIcons value={val as string} />
                                            </dd>
                                          </div>
                                        );
                                      }
                                      let text: string;
                                      if (isBool) {
                                        text = Boolean(val) ? "是" : "否";
                                      } else if (key === "經銷約開始日" || key === "經銷約結束日") {
                                        text = formatPartnerDateDisplay(val as string);
                                      } else {
                                        const s = String(val ?? "").trim();
                                        text = s === "" ? "—" : s;
                                      }
                                      return (
                                        <div key={key}>
                                          <dt className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">{label}</dt>
                                          <dd
                                            className={`mt-0.5 text-sm leading-relaxed text-stone-800 ${
                                              key === "經銷約開始日" || key === "經銷約結束日" ? "tabular-nums" : ""
                                            }`}
                                          >
                                            {text}
                                          </dd>
                                        </div>
                                      );
                                    })}
                                  </dl>
                                </div>
                              ))}
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
                                    KOL開發者: String(pt.KOL開發者 ?? ""),
                                    經銷約開始日: String(pt.經銷約開始日 ?? ""),
                                    自來件分潤: String(pt.自來件分潤 ?? ""),
                                    "SDH開發分件分潤": String(pt["SDH開發分件分潤"] ?? ""),
                                    經銷約結束日: String(pt.經銷約結束日 ?? ""),
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
                                  KOL開發者: String(pt.KOL開發者 ?? ""),
                                  經銷約開始日: String(pt.經銷約開始日 ?? ""),
                                  自來件分潤: String(pt.自來件分潤 ?? ""),
                                  "SDH開發分件分潤": String(pt["SDH開發分件分潤"] ?? ""),
                                  經銷約結束日: String(pt.經銷約結束日 ?? ""),
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
            <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
              <div className="flex shrink-0 rounded-lg border border-amber-200 bg-amber-50/90 p-0.5 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setTasksLifecycleTab("in_progress")}
                  className={`rounded-md px-3 py-1.5 transition ${
                    tasksLifecycleTab === "in_progress" ? "bg-amber-500 text-slate-900 shadow-sm" : "text-stone-600 hover:text-stone-900"
                  }`}
                >
                  進行中
                  <span className="ml-1 tabular-nums text-[10px] opacity-80">({tasksLifecycleCounts.inProgress})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTasksLifecycleTab("completed")}
                  className={`rounded-md px-3 py-1.5 transition ${
                    tasksLifecycleTab === "completed" ? "bg-amber-500 text-slate-900 shadow-sm" : "text-stone-600 hover:text-stone-900"
                  }`}
                >
                  已完成
                  <span className="ml-1 tabular-nums text-[10px] opacity-80">({tasksLifecycleCounts.completed})</span>
                </button>
              </div>
              {canManageTaskWorkloadView && (
                <div className="flex shrink-0 rounded-lg border border-amber-200 bg-amber-50/90 p-0.5 text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() => setTasksSectionViewMode("list")}
                    className={`rounded-md px-3 py-1.5 transition ${tasksSectionViewMode === "list" ? "bg-amber-500 text-slate-900 shadow-sm" : "text-stone-600 hover:text-stone-900"}`}
                  >
                    列表
                  </button>
                  <button
                    type="button"
                    onClick={() => setTasksSectionViewMode("byAssignee")}
                    disabled={tasksLifecycleTab !== "in_progress"}
                    className={`rounded-md px-3 py-1.5 transition ${tasksSectionViewMode === "byAssignee" ? "bg-amber-500 text-slate-900 shadow-sm" : "text-stone-600 hover:text-stone-900"}`}
                  >
                    依員工
                  </button>
                </div>
              )}
              <input
                type="text"
                value={tasksSearch}
                onChange={(e) => setTasksSearch(e.target.value)}
                placeholder="搜尋專案名稱、任務、負責人、到期日…"
                className="w-full min-w-0 max-w-60 rounded-full border border-stone-200 bg-stone-50 px-3.5 py-1.5 text-xs text-stone-800 placeholder:text-stone-500 focus:border-amber-500/60 focus:outline-none"
              />
            </div>
          </div>
          {canManageTaskWorkloadView && tasksSectionViewMode === "byAssignee" && tasksLifecycleTab === "in_progress" ? (
            <div className="rounded-xl border border-amber-200/80 bg-amber-50/50 p-4">
              <p className="mb-3 text-xs leading-relaxed text-stone-600">
                依「② 資料可見規則」與上方搜尋結果，彙總每位負責人<strong>未完成</strong>任務數。
                <strong className="text-amber-900">即將到期</strong>：今天起算 {TASK_DUE_SOON_DAYS} 天內（含當天）；<strong className="text-red-800">已逾期</strong>：超過到期日仍未完成。
              </p>
              {taskWorkloadByAssignee.length === 0 ? (
                <p className="text-sm text-stone-500">無符合資料</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-stone-200/90 bg-white/90">
                  <table className="min-w-full divide-y divide-stone-200 text-sm">
                    <thead className="bg-stone-100">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-amber-800">負責人</th>
                        <th className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wider text-stone-600">進行中</th>
                        <th className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wider text-amber-800">即將到期</th>
                        <th className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wider text-red-800">已逾期</th>
                        <th className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wider text-stone-500">未設到期日</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100 bg-white">
                      {taskWorkloadByAssignee.map((row) => {
                        const drillOpen =
                          workloadDrill?.assigneeLabel === row.assigneeLabel && workloadDrill?.kind === "open";
                        const drillSoon =
                          workloadDrill?.assigneeLabel === row.assigneeLabel && workloadDrill?.kind === "soon";
                        const drillOver =
                          workloadDrill?.assigneeLabel === row.assigneeLabel && workloadDrill?.kind === "overdue";
                        const drillNoDue =
                          workloadDrill?.assigneeLabel === row.assigneeLabel && workloadDrill?.kind === "noDue";
                        const cellBtn =
                          "min-w-[2.5rem] rounded-md px-2 py-1 transition disabled:cursor-not-allowed disabled:opacity-40";
                        return (
                          <tr key={row.assigneeLabel} className="hover:bg-amber-50/50">
                            <td className="whitespace-nowrap px-4 py-3 font-medium text-stone-800">{row.assigneeLabel}</td>
                            <td className="px-2 py-2 text-center tabular-nums text-stone-700">
                              <button
                                type="button"
                                disabled={row.open <= 0}
                                onClick={() =>
                                  setWorkloadDrill((prev) =>
                                    prev?.assigneeLabel === row.assigneeLabel && prev.kind === "open"
                                      ? null
                                      : { assigneeLabel: row.assigneeLabel, kind: "open" }
                                  )
                                }
                                className={`${cellBtn} ${drillOpen ? "bg-stone-200 font-semibold ring-2 ring-amber-400/70" : "hover:bg-stone-100"}`}
                              >
                                {row.open}
                              </button>
                            </td>
                            <td className="px-2 py-2 text-center tabular-nums font-semibold text-amber-800">
                              <button
                                type="button"
                                disabled={row.soon <= 0}
                                onClick={() =>
                                  setWorkloadDrill((prev) =>
                                    prev?.assigneeLabel === row.assigneeLabel && prev.kind === "soon"
                                      ? null
                                      : { assigneeLabel: row.assigneeLabel, kind: "soon" }
                                  )
                                }
                                className={`${cellBtn} ${drillSoon ? "bg-amber-100 font-semibold ring-2 ring-amber-500/80" : "hover:bg-amber-50"}`}
                              >
                                {row.soon}
                              </button>
                            </td>
                            <td className="px-2 py-2 text-center tabular-nums font-semibold text-red-700">
                              <button
                                type="button"
                                disabled={row.overdue <= 0}
                                onClick={() =>
                                  setWorkloadDrill((prev) =>
                                    prev?.assigneeLabel === row.assigneeLabel && prev.kind === "overdue"
                                      ? null
                                      : { assigneeLabel: row.assigneeLabel, kind: "overdue" }
                                  )
                                }
                                className={`${cellBtn} ${drillOver ? "bg-red-50 font-semibold ring-2 ring-red-400/70" : "hover:bg-red-50/80"}`}
                              >
                                {row.overdue}
                              </button>
                            </td>
                            <td className="px-2 py-2 text-center tabular-nums text-stone-500">
                              <button
                                type="button"
                                disabled={row.noDueOpen <= 0}
                                onClick={() =>
                                  setWorkloadDrill((prev) =>
                                    prev?.assigneeLabel === row.assigneeLabel && prev.kind === "noDue"
                                      ? null
                                      : { assigneeLabel: row.assigneeLabel, kind: "noDue" }
                                  )
                                }
                                className={`${cellBtn} ${drillNoDue ? "bg-stone-100 font-semibold ring-2 ring-stone-400/70" : "hover:bg-stone-100"}`}
                              >
                                {row.noDueOpen}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {workloadDrill && (
                <div className="mt-4 rounded-lg border border-amber-200/90 bg-white/95 p-4 shadow-sm">
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-amber-900">
                        {workloadDrill.assigneeLabel}
                        <span className="mx-1.5 text-stone-400">·</span>
                        {workloadDrillKindLabel(workloadDrill.kind)}
                        <span className="ml-2 font-normal text-stone-500">（{workloadDrillTasks.length} 筆）</span>
                      </h3>
                      <p className="mt-1 text-xs text-stone-500">點列可開啟任務完整編輯；再點同一數字可收合。</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setWorkloadDrill(null)}
                      className="shrink-0 rounded-lg border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-semibold text-stone-600 transition hover:bg-amber-50 hover:text-amber-900"
                    >
                      收合
                    </button>
                  </div>
                  {workloadDrillTasks.length === 0 ? (
                    <p className="text-sm text-stone-500">目前無符合的任務（可能資料已更新）。</p>
                  ) : (
                    <div className="max-h-[min(360px,50vh)] overflow-y-auto overflow-x-auto rounded-md border border-stone-100">
                      <table className="min-w-full divide-y divide-stone-100 text-sm">
                        <thead className="sticky top-0 bg-stone-50">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-stone-600">任務</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-stone-600">專案名稱</th>
                            <th className="px-3 py-2 text-center text-xs font-semibold text-stone-600">到期日</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-stone-600">任務類型</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-stone-50 bg-white">
                          {workloadDrillTasks.map((t, idx) => {
                            const dueHint = formatTaskDueShortHint(t);
                            const dueStatus = getTaskDueUiStatus(t.任務完成, t.到期日);
                            return (
                            <tr
                              key={t.任務ID ?? idx}
                              className="cursor-pointer transition hover:bg-amber-50/80"
                              onClick={() => setSelectedTask(t)}
                            >
                              <td className="max-w-[200px] px-3 py-2.5 font-medium text-stone-900">
                                <span className="line-clamp-2">{t.任務 ?? "—"}</span>
                              </td>
                              <td className="max-w-[160px] px-3 py-2.5 text-stone-600">
                                <span className="line-clamp-2">{t.專案名稱 ?? "—"}</span>
                              </td>
                              <td className="whitespace-nowrap px-3 py-2.5 text-center text-xs tabular-nums">
                                <span
                                  className={
                                    dueStatus === "overdue"
                                      ? "font-semibold text-red-700"
                                      : dueStatus === "soon"
                                        ? "font-semibold text-amber-800"
                                        : "text-stone-700"
                                  }
                                >
                                  {formatTaskDueYmd(t.到期日)}
                                  {dueHint ? (
                                    <span className="ml-1 text-[10px] font-normal text-stone-500">{dueHint}</span>
                                  ) : null}
                                </span>
                              </td>
                              <td className="whitespace-nowrap px-3 py-2.5 text-stone-600">{t.任務類型 ?? "—"}</td>
                            </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <>
          {/* 小螢幕：任務卡片 */}
          <div className="space-y-3 md:hidden">
            {filteredTasks.length === 0 ? (
              <p className="rounded-xl border border-stone-200/90 px-4 py-8 text-center text-stone-500">尚無任務資料（請在大總表展開專案後新增任務）</p>
            ) : tasksLifecycleFilteredList.length === 0 ? (
              <p className="rounded-xl border border-stone-200/90 px-4 py-8 text-center text-stone-500">
                {tasksLifecycleTab === "in_progress" ? "目前沒有進行中任務" : "目前沒有已完成任務"}
              </p>
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
                      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-stone-500" onClick={(e) => e.stopPropagation()}>
                        <span className="min-w-0 truncate">{t.專案名稱 ?? "—"}</span>
                        <TaskProjectInfoButton project={masterByProjectId.get(String(t.專案ID ?? "").trim())} />
                      </p>
                    </div>
                    <span className={`shrink-0 rounded px-2 py-0.5 text-xs ${t.任務完成 ? "bg-amber-100 text-amber-800" : "bg-stone-200 text-stone-500"}`}>{t.任務完成 ? "已完成" : "進行中"}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-stone-500" onClick={(e) => e.stopPropagation()}>
                    <span>開始：{formatTaskDisplayTime(t.開始時間)}</span>
                    <span>完成：{formatTaskDisplayTime(t.完成時間)}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-stone-600" onClick={(e) => e.stopPropagation()}>
                    到期日：
                    <span
                      className={
                        getTaskDueUiStatus(t.任務完成, t.到期日) === "overdue"
                          ? "font-semibold text-red-700"
                          : getTaskDueUiStatus(t.任務完成, t.到期日) === "soon"
                            ? "font-semibold text-amber-800"
                            : ""
                      }
                    >
                      {formatTaskDueYmd(t.到期日)}
                    </span>
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-2" onClick={(e) => e.stopPropagation()}>
                    <span className="text-xs font-medium text-stone-600">任務完成</span>
                    <button
                      type="button"
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (!t.任務ID) return;
                        const next = !t.任務完成;
                        try {
                          const res = await fetch("/api/tasks", {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ 任務ID: t.任務ID, 任務完成: next }),
                          });
                          const data = (await safeResJson(res)) as { ok?: boolean; task?: TaskRow };
                          if (res.ok && data.ok) setTasks((prev) => prev.map((x) => (x.任務ID === t.任務ID ? data.task! : x)));
                        } catch {
                          /* 忽略 */
                        }
                      }}
                      disabled={!t.任務ID}
                      className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md border-2 transition hover:border-amber-400/70 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-40"
                      style={{
                        backgroundColor: t.任務完成 ? "rgba(245,158,11,0.25)" : "transparent",
                        borderColor: t.任務完成 ? "rgba(245,158,11,0.5)" : "rgb(214 211 209)",
                      }}
                      title={t.任務完成 ? "點擊取消完成" : "點擊標記完成"}
                    >
                      {t.任務完成 ? <span className="text-sm text-amber-800">✓</span> : null}
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <span className="text-xs text-stone-500">任務類型</span>
                    <select
                      value={t.任務類型 ?? ""}
                      onChange={async (e) => {
                        if (!t.任務ID) return;
                        const next = e.target.value.trim();
                        try {
                          const res = await fetch("/api/tasks", {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ 任務ID: t.任務ID, 任務類型: next || null }),
                          });
                          const data = (await safeResJson(res)) as { ok?: boolean; task?: TaskRow };
                          if (res.ok && data.ok) setTasks((prev) => prev.map((x) => (x.任務ID === t.任務ID ? data.task! : x)));
                        } catch {
                          /* 忽略 */
                        }
                      }}
                      disabled={!t.任務ID}
                      className="min-w-0 max-w-full flex-1 rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-xs font-medium text-stone-700 focus:border-amber-400/70 focus:outline-none disabled:opacity-50"
                    >
                      <option value="">—</option>
                      {taskTypeOptions.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                      {t.任務類型 && !taskTypeOptions.includes(t.任務類型) ? (
                        <option value={t.任務類型}>{t.任務類型}</option>
                      ) : null}
                    </select>
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
                    <th
                      key={k}
                      className={
                        k === "專案ID"
                          ? "px-4 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-amber-800"
                          : k === "任務完成" || k === "開始時間" || k === "完成時間"
                            ? "px-4 py-3.5 text-center text-xs font-bold uppercase tracking-wider text-stone-600"
                            : "px-4 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-stone-600"
                      }
                    >
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
                ) : tasksLifecycleFilteredList.length === 0 ? (
                  <tr>
                    <td colSpan={tasksVisibleCols.length || 6} className="px-4 py-8 text-center text-base font-medium text-stone-500">
                      {tasksLifecycleTab === "in_progress" ? "目前沒有進行中任務" : "目前沒有已完成任務"}
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
                        if (k === "任務") {
                          const taskTitle = t.任務 ?? "—";
                          return (
                            <td key={k} className="max-w-[280px] px-4 py-3.5">
                              <span className="block min-w-0 truncate text-sm font-medium text-stone-900" title={taskTitle !== "—" ? taskTitle : undefined}>
                                {taskTitle}
                              </span>
                            </td>
                          );
                        }
                        if (k === "到期日") {
                          const ymd = t.到期日;
                          const st = getTaskDueUiStatus(t.任務完成, ymd);
                          const cls =
                            st === "overdue"
                              ? "text-red-700"
                              : st === "soon"
                                ? "text-amber-800"
                                : "text-stone-600";
                          const days = dueDaysFromToday(ymd);
                          const hint =
                            days === null || t.任務完成
                              ? ""
                              : days < 0
                                ? `逾期 ${-days} 天`
                                : days <= TASK_DUE_SOON_DAYS
                                  ? `剩 ${days} 天`
                                  : "";
                          return (
                            <td key={k} className={`whitespace-nowrap px-4 py-3.5 text-xs tabular-nums ${cls}`}>
                              <span className="font-medium">{formatTaskDueYmd(ymd)}</span>
                              {hint ? (
                                <span className="ml-1 text-[10px] font-normal text-stone-500">{hint}</span>
                              ) : null}
                            </td>
                          );
                        }
                        if (k === "開始時間" || k === "完成時間") {
                          const raw = k === "開始時間" ? t.開始時間 : t.完成時間;
                          return (
                            <td key={k} className="whitespace-nowrap px-4 py-3.5 text-center text-xs tabular-nums text-stone-600">
                              {formatTaskDisplayTime(raw)}
                            </td>
                          );
                        }
                        if (k === "任務類型") {
                          const val = t.任務類型 ?? "";
                          const showOrphan = Boolean(val && !taskTypeOptions.includes(val));
                          return (
                            <td key={k} className="whitespace-nowrap px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                              <select
                                value={val}
                                onChange={async (e) => {
                                  if (!t.任務ID) return;
                                  const next = e.target.value.trim();
                                  try {
                                    const res = await fetch("/api/tasks", {
                                      method: "PATCH",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ 任務ID: t.任務ID, 任務類型: next || null }),
                                    });
                                    const data = (await safeResJson(res)) as { ok?: boolean; task?: TaskRow };
                                    if (res.ok && data.ok) setTasks((prev) => prev.map((x) => (x.任務ID === t.任務ID ? data.task! : x)));
                                  } catch {
                                    /* 忽略 */
                                  }
                                }}
                                disabled={!t.任務ID}
                                className="max-w-[220px] rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm font-medium text-stone-700 focus:border-amber-400/70 focus:outline-none disabled:opacity-50"
                              >
                                <option value="">—</option>
                                {taskTypeOptions.map((o) => (
                                  <option key={o} value={o}>
                                    {o}
                                  </option>
                                ))}
                                {showOrphan ? <option value={val}>{val}</option> : null}
                              </select>
                            </td>
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
                        if (k === "備註") {
                          const note = String(t.備註 ?? "").trim();
                          return (
                            <td key={k} className="max-w-[200px] px-4 py-3.5 text-sm text-stone-600" title={note || undefined}>
                              <span className="line-clamp-2 break-words">{note || "—"}</span>
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
                                style={{ backgroundColor: t.任務完成 ? "rgba(245,158,11,0.25)" : "transparent", borderColor: t.任務完成 ? "rgba(245,158,11,0.5)" : "rgb(214 211 209)" }}
                                title={t.任務完成 ? "點擊取消完成" : "點擊標記完成"}
                              >
                                {t.任務完成 ? <span className="text-amber-800">✓</span> : null}
                              </button>
                            </td>
                          );
                        }
                        const val = (t as unknown as Record<string, unknown>)[k];
                        const str = String(val ?? "—");
                        if (k === "專案名稱") {
                          return (
                            <td key={k} className="max-w-[220px] px-4 py-3.5 text-sm font-medium text-stone-600" title={str}>
                              <span className="flex min-w-0 items-center gap-1.5">
                                <span className="min-w-0 truncate">{str}</span>
                                <TaskProjectInfoButton project={masterByProjectId.get(String(t.專案ID ?? "").trim())} />
                              </span>
                            </td>
                          );
                        }
                        return (
                          <td key={k} className={k === "任務" ? "max-w-[240px] truncate px-4 py-3.5 text-sm font-medium text-stone-900" : "whitespace-nowrap px-4 py-3.5 text-sm font-medium text-stone-600"} title={k === "任務" ? str : undefined}>
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
            </>
          )}
        </section>
        )}

        {/* 分潤表 */}
        {activeSection === "payout" && (
        <section className="rounded-2xl border border-stone-200/90 bg-white/90 p-4 shadow-xl ring-1 ring-amber-100/60 sm:p-6">
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-stone-900">分潤表</h2>
              <p className="mt-1 max-w-2xl text-xs text-stone-500">
                「廠商預計付款日」由大總表專案編輯；財務填寫「廠商付款日期」後，同專案分潤列會帶入並歸入「待分潤」；填寫「員工分潤日期」後帶入「分潤匯款日期」並歸入「已分潤」。
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-1 rounded-xl border border-stone-200 bg-amber-50/90 p-1">
              {(
                [
                  { key: "pending_vendor" as const, label: "待結帳" },
                  { key: "pending_payout" as const, label: "待分潤" },
                  { key: "settled" as const, label: "已分潤" },
                ] as const
              ).map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPayoutWorkflowTab(key)}
                  className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
                    payoutWorkflowTab === key ? "bg-amber-500 text-slate-900 shadow shadow-amber-200/40" : "text-stone-500 hover:text-stone-900"
                  }`}
                >
                  {label}
                  <span className="ml-1 tabular-nums text-[10px] opacity-80">
                    (
                    {key === "pending_vendor"
                      ? payoutWorkflowCounts.pending_vendor
                      : key === "pending_payout"
                        ? payoutWorkflowCounts.pending_payout
                        : payoutWorkflowCounts.settled}
                    )
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="mb-4 flex flex-wrap items-center justify-end gap-3">
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
              <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <div className="group relative overflow-hidden rounded-2xl border border-stone-200/70 bg-gradient-to-br from-white via-stone-50/80 to-stone-100/60 px-3 py-3.5 shadow-[0_12px_40px_-12px_rgba(120,113,108,0.35)] ring-1 ring-stone-200/50 transition duration-300 hover:-translate-y-1 hover:shadow-[0_20px_50px_-12px_rgba(120,113,108,0.45)] sm:px-4 sm:py-4">
                  <div className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-stone-300/25 blur-2xl transition duration-500 group-hover:bg-stone-400/30" />
                  <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-stone-400 via-stone-300 to-amber-200/80" />
                  <div className="relative">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-stone-500">待結帳筆數</p>
                    <p className="mt-2 bg-gradient-to-br from-stone-800 to-stone-600 bg-clip-text text-2xl font-extrabold tabular-nums tracking-tight text-transparent sm:text-3xl">{payoutWorkflowCounts.pending_vendor}</p>
                    <p className="mt-1 text-[10px] font-medium text-stone-400">廠商未付款</p>
                  </div>
                </div>
                <div className="group relative overflow-hidden rounded-2xl border border-amber-200/70 bg-gradient-to-br from-amber-50/95 via-white to-orange-50/50 px-3 py-3.5 shadow-[0_12px_40px_-12px_rgba(245,158,11,0.35)] ring-1 ring-amber-200/60 transition duration-300 hover:-translate-y-1 hover:shadow-[0_20px_50px_-10px_rgba(245,158,11,0.45)] sm:px-4 sm:py-4">
                  <div className="pointer-events-none absolute -right-6 -top-8 h-32 w-32 rounded-full bg-amber-400/30 blur-3xl transition duration-500 group-hover:bg-amber-400/45" />
                  <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber-500 via-orange-400 to-amber-300" />
                  <div className="relative">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-amber-900/80">待分潤筆數</p>
                    <p className="mt-2 bg-gradient-to-br from-amber-900 to-orange-700 bg-clip-text text-2xl font-extrabold tabular-nums tracking-tight text-transparent sm:text-3xl">{payoutWorkflowCounts.pending_payout}</p>
                    <p className="mt-1 text-[10px] font-medium text-amber-800/70">廠商已付、待匯分潤</p>
                  </div>
                </div>
                <div className="group relative overflow-hidden rounded-2xl border border-emerald-200/70 bg-gradient-to-br from-emerald-50/90 via-white to-teal-50/40 px-3 py-3.5 shadow-[0_12px_40px_-12px_rgba(16,185,129,0.3)] ring-1 ring-emerald-200/55 transition duration-300 hover:-translate-y-1 hover:shadow-[0_20px_50px_-10px_rgba(16,185,129,0.4)] sm:px-4 sm:py-4">
                  <div className="pointer-events-none absolute -right-6 -top-8 h-32 w-32 rounded-full bg-emerald-400/25 blur-3xl transition duration-500 group-hover:bg-emerald-400/40" />
                  <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-300" />
                  <div className="relative">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-900/80">已分潤金額合計</p>
                    <p className="mt-2 bg-gradient-to-br from-emerald-900 to-teal-700 bg-clip-text text-xl font-extrabold tabular-nums tracking-tight text-transparent sm:text-2xl">{formatAmount(String(Math.round(payoutSettledAmountSum)))}</p>
                    <p className="mt-1 text-[10px] font-medium text-emerald-800/65">僅「已分潤」列加總</p>
                  </div>
                </div>
                <div className="group relative overflow-hidden rounded-2xl border border-amber-300/80 bg-gradient-to-br from-amber-100/90 via-amber-50 to-orange-100/60 px-3 py-3.5 shadow-[0_14px_44px_-12px_rgba(217,119,6,0.4)] ring-2 ring-amber-300/50 transition duration-300 hover:-translate-y-1 hover:shadow-[0_22px_56px_-10px_rgba(217,119,6,0.5)] sm:px-4 sm:py-4">
                  <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_100%_0%,rgba(251,191,36,0.35),transparent_55%)] opacity-90" />
                  <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber-600 via-orange-500 to-amber-400" />
                  <div className="relative">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-amber-950/90">待分潤金額合計</p>
                    <p className="mt-2 bg-gradient-to-br from-amber-950 to-orange-900 bg-clip-text text-xl font-extrabold tabular-nums tracking-tight text-transparent sm:text-2xl">{formatAmount(String(Math.round(payoutPendingPayoutAmountSum)))}</p>
                    <p className="mt-1 text-[10px] font-semibold text-amber-950/65">僅「待分潤」列加總</p>
                  </div>
                </div>
              </div>
              {/* 小螢幕：卡片式收納顯示（分潤金額為主、次要資訊、其他可摺疊） */}
              <div className="space-y-3 md:hidden">
                {searchedPayout.length === 0 ? (
                  <p className="rounded-xl border border-stone-200/90 px-4 py-8 text-center text-stone-500">
                    {deferredPayoutSearch.trim()
                      ? "沒有符合搜尋結果"
                      : "此階段目前沒有分潤列，可切換上方「待結帳／待分潤／已分潤」或至財務填寫廠商／員工日期。"}
                  </p>
                ) : (
                  visiblePayoutRows.map((row, i) => {
                    const r = row as unknown as Record<string, unknown>;
                    const cardKey = String(row.id ?? `payout-${i}`);
                    const isExpanded = expandedPayoutCardKey === cardKey;
                    const showAmt = payoutVisibleCols.includes("分潤金額");
                    const showPct = payoutVisibleCols.includes("分潤成數");
                    const showTitle = payoutVisibleCols.includes("專案名稱");
                    const detailKeys =
                      payoutWorkflowTab === "settled"
                        ? (["專案ID", "廠商預計付款日", "廠商付款日期", "分潤匯款日期", "專案營收", "專案總金額未稅", "分潤類型", "領取人"] as const)
                        : (["專案ID", "廠商預計付款日", "廠商付款日期", "專案營收", "專案總金額未稅", "分潤類型", "領取人"] as const);
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
                                {payoutVisibleCols.includes("廠商預計付款日") && (
                                  <p><span className="text-stone-500">廠商預計付款日</span> {String(r.廠商預計付款日 ?? "—")}</p>
                                )}
                                {payoutVisibleCols.includes("廠商付款日期") && (
                                  <p><span className="text-stone-500">廠商付款日期</span> {String(r.廠商付款日期 ?? "—")}</p>
                                )}
                                {payoutWorkflowTab === "settled" && payoutVisibleCols.includes("分潤匯款日期") && (
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
                      {payoutColsForActiveWorkflowTab.map((k) => (
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
                        <td colSpan={payoutColsForActiveWorkflowTab.length || 7} className="px-4 py-8 text-center text-base font-medium text-stone-500">
                          {deferredPayoutSearch.trim()
                            ? "沒有符合搜尋結果"
                            : "此階段目前沒有分潤列，可切換上方「待結帳／待分潤／已分潤」或至財務填寫廠商／員工日期。"}
                        </td>
                      </tr>
                    ) : (
                      visiblePayoutRows.map((row, i) => (
                        <tr key={row.id ?? i} className="hover:bg-amber-50/80">
                          {payoutColsForActiveWorkflowTab.map((k) => {
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

        {/* 財務：依專案 + 發票清冊（發票 DB 可無專案ID） */}
        {activeSection === "finance" && (
        <section className="rounded-2xl border border-stone-200/90 bg-white/90 p-4 shadow-xl ring-1 ring-amber-100/60 sm:p-6">
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-stone-900">財務</h2>
              <p className="mt-1 text-xs text-stone-500">
                依專案：金額與指標由大總表同步帶入；發票清冊記錄收款憑證；付款記錄用來管理對外付款與支出。
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-1 rounded-xl border border-stone-200 bg-amber-50/90 p-1">
              <button
                type="button"
                onClick={() => setFinanceSubTab("byProject")}
                className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
                  financeSubTab === "byProject" ? "bg-amber-500 text-slate-900 shadow shadow-amber-200/40" : "text-stone-500 hover:text-stone-900"
                }`}
              >
                依專案
              </button>
              <button
                type="button"
                onClick={() => setFinanceSubTab("invoices")}
                className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
                  financeSubTab === "invoices" ? "bg-amber-500 text-slate-900 shadow shadow-amber-200/40" : "text-stone-500 hover:text-stone-900"
                }`}
              >
                發票清冊
              </button>
              <button
                type="button"
                onClick={() => setFinanceSubTab("payments")}
                className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
                  financeSubTab === "payments" ? "bg-amber-500 text-slate-900 shadow shadow-amber-200/40" : "text-stone-500 hover:text-stone-900"
                }`}
              >
                付款記錄
              </button>
            </div>
          </div>

          {financeSubTab === "byProject" && (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-end gap-3">
                <input
                  type="text"
                  value={financeSearch}
                  onChange={(e) => setFinanceSearch(e.target.value)}
                  placeholder="搜尋專案ID、專案名稱、金額、日期…"
                  className="w-full min-w-0 max-w-60 rounded-full border border-stone-200 bg-stone-50 px-3.5 py-1.5 text-xs text-stone-800 placeholder:text-stone-500 focus:border-amber-500/60 focus:outline-none"
                />
              </div>
              {financeEditError && (
                <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{financeEditError}</p>
              )}
              {finance.length > 0 && (
                <p className="mb-2 text-[11px] text-stone-500">
                  僅「廠商付款日期」「員工分潤日期」可編輯（日曆選擇）；離開欄位時才會儲存。若儲存失敗，請確認 Supabase 已套用 migration「034_財務_廠商員工欄位改為日期」。
                </p>
              )}
              <div className="overflow-x-auto rounded-xl border border-stone-200/90">
                {finance.length === 0 ? (
                  <p className="px-4 py-8 text-center text-stone-500">尚無財務資料（專案建立後會自動對應一列）</p>
                ) : (
                  <table className="min-w-full divide-y divide-stone-200">
                    <thead className="bg-stone-100">
                      <tr>
                        {financeVisibleCols.map((k) => (
                          <th
                            key={k}
                            className={
                              k === "專案ID" || k === "專案名稱"
                                ? "px-4 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-amber-800"
                                : "px-4 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-stone-600"
                            }
                          >
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
                        visibleFinanceRows.map((row, i) => {
                          const fid = String(row.專案ID ?? "").trim();
                          const financeSaving = fid !== "" && financeEditSaving專案ID === fid;
                          return (
                            <tr key={fid || `fin-row-${i}`} className="hover:bg-amber-50/80">
                              {financeVisibleCols.map((k) => {
                                const v = (row as unknown as Record<string, unknown>)[k];
                                const str = String(v ?? "—");
                                if (k === "專案ID") {
                                  return (
                                    <td key={k} className="whitespace-nowrap px-4 py-3.5 text-sm font-medium text-stone-900">
                                      {str}
                                    </td>
                                  );
                                }
                                if (k === "專案名稱") {
                                  return (
                                    <td
                                      key={k}
                                      className="max-w-[200px] truncate px-4 py-3.5 text-sm text-stone-700"
                                      title={str !== "—" ? str : undefined}
                                    >
                                      {str}
                                    </td>
                                  );
                                }
                                if (!fid || !isFinanceByProjectEditableColumn(k)) {
                                  return (
                                    <td key={k} className="whitespace-nowrap px-4 py-3.5 text-sm text-stone-600">
                                      {str}
                                    </td>
                                  );
                                }
                                const rawVal = v == null ? "" : String(v);
                                const dateVal = normalizeDateForInput(rawVal);
                                const finDateInputCls =
                                  "w-full min-w-[9.5rem] max-w-[11rem] rounded border border-stone-200 bg-white px-1.5 py-1 text-xs font-sans tabular-nums text-stone-800 focus:border-amber-500/60 focus:outline-none disabled:opacity-60 [color-scheme:light]";
                                return (
                                  <td key={k} className="min-w-[9.5rem] max-w-[11rem] px-2 py-2 align-middle">
                                    <input
                                      type="date"
                                      value={dateVal}
                                      disabled={financeSaving}
                                      title={rawVal && rawVal !== dateVal ? `已正規化為西元日期；原值：${rawVal}` : undefined}
                                      onChange={(e) => {
                                        setFinanceEditError(null);
                                        const next = e.target.value;
                                        setFinance((prev) =>
                                          prev.map((r) =>
                                            String(r.專案ID ?? "").trim() === fid ? { ...r, [k]: next } : r
                                          )
                                        );
                                      }}
                                      onBlur={() => {
                                        void persistFinanceRowBy專案ID(fid);
                                      }}
                                      className={finDateInputCls}
                                    />
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                )}
              </div>
              {searchedFinance.length > visibleFinanceRows.length && (
                <p className="mt-2 text-right text-xs text-stone-500">載入中 {visibleFinanceRows.length} / {searchedFinance.length}</p>
              )}
            </>
          )}

          {financeSubTab === "invoices" && (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setInvoiceCreateError(null);
                      setInvoiceDraftRows([emptyInvoiceDraftRow(), emptyInvoiceDraftRow(), emptyInvoiceDraftRow()]);
                      try {
                        const p = localStorage.getItem(LS_INVOICE_PREFIX);
                        const pad = localStorage.getItem(LS_INVOICE_PAD);
                        const next = localStorage.getItem(LS_INVOICE_NEXT);
                        if (p !== null) setInvoiceSeqPrefix(p);
                        if (pad !== null) setInvoiceSeqPad(pad);
                        if (next !== null && String(next).trim() !== "") setInvoiceSeqStart(String(next));
                        else setInvoiceSeqStart("1");
                      } catch {
                        setInvoiceSeqStart("1");
                      }
                      setInvoiceSeqCount("3");
                      setShowInvoiceCreateModal(true);
                    }}
                    className="rounded-xl border border-amber-400/80 bg-amber-500 px-4 py-2 text-xs font-bold text-slate-900 shadow-sm shadow-amber-200/40 transition hover:bg-amber-400"
                  >
                    新增發票（批次）
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setInvoiceCreateError(null);
                      setInvoicePasteText("");
                      setShowInvoicePasteImportModal(true);
                    }}
                    className="rounded-xl border border-amber-400/80 bg-white px-4 py-2 text-xs font-bold text-amber-900 shadow-sm shadow-amber-100/40 transition hover:bg-amber-50"
                  >
                    貼上匯入
                  </button>
                </div>
                <input
                  type="text"
                  value={invoicesSearch}
                  onChange={(e) => setInvoicesSearch(e.target.value)}
                  placeholder="搜尋專案ID、發票號碼…"
                  className="w-full min-w-0 max-w-60 rounded-full border border-stone-200 bg-stone-50 px-3.5 py-1.5 text-xs text-stone-800 placeholder:text-stone-500 focus:border-amber-500/60 focus:outline-none"
                />
              </div>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl border border-stone-200 bg-stone-50/90 p-1">
                  {invoiceMonthTabs.map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => {
                        setInvoiceMonthTab(tab.key);
                        setSelectedInvoiceIds([]);
                      }}
                      className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                        invoiceMonthTab === tab.key
                          ? "bg-amber-500 text-slate-900 shadow shadow-amber-200/40"
                          : "text-stone-500 hover:bg-white hover:text-stone-900"
                      }`}
                    >
                      {tab.label}
                      <span className="ml-1 text-[10px] opacity-70">{tab.count}</span>
                    </button>
                  ))}
                </div>
                {selectedInvoiceIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => void deleteInvoicesByIdList(selectedInvoiceIds)}
                    disabled={deletingInvoiceIds.length > 0}
                    className="rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 transition hover:bg-red-100 disabled:opacity-60"
                  >
                    刪除已選 {selectedInvoiceIds.length} 筆
                  </button>
                )}
              </div>
              {invoiceEditError && (
                <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{invoiceEditError}</p>
              )}
              {invoices.length > 0 && (
                <p className="mb-2 text-[11px] text-stone-500">
                  各欄可直接編輯；離開欄位時才會儲存。發票號碼不可空白。
                </p>
              )}
              <div className="overflow-x-auto rounded-xl border border-stone-200/90">
                {invoices.length === 0 ? (
                  <p className="px-4 py-8 text-center text-stone-500">尚無發票資料</p>
                ) : (
                  <table className="min-w-full divide-y divide-stone-200">
                    <thead className="bg-stone-100">
                      <tr>
                        <th className="w-10 px-3 py-3.5 text-left">
                          <input
                            type="checkbox"
                            checked={
                              visibleInvoiceIds.length > 0 &&
                              visibleInvoiceIds.every((id) => selectedInvoiceIdSet.has(id))
                            }
                            onChange={(e) => {
                              setSelectedInvoiceIds((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) visibleInvoiceIds.forEach((id) => next.add(id));
                                else visibleInvoiceIds.forEach((id) => next.delete(id));
                                return [...next];
                              });
                            }}
                            className="h-4 w-4 rounded border-stone-300 text-amber-500"
                            aria-label="選取目前顯示發票"
                          />
                        </th>
                        {invoicesVisibleCols.map((k) => (
                          <th key={k} className={k === "專案ID" ? "px-4 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-amber-800" : "px-4 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-stone-600"}>
                            {tableColumnLabels.invoices?.[k] ?? k}
                          </th>
                        ))}
                        <th className="px-4 py-3.5 text-right text-xs font-bold uppercase tracking-wider text-stone-600">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-200 bg-amber-50/40">
                      {searchedInvoices.length === 0 ? (
                        <tr>
                          <td colSpan={(invoicesVisibleCols.length || 8) + 2} className="px-4 py-8 text-center text-base font-medium text-stone-500">
                            沒有符合搜尋結果
                          </td>
                        </tr>
                      ) : (
                        visibleInvoicesRows.map((inv, i) => {
                          const rowId = typeof inv.id === "string" && inv.id ? inv.id : null;
                          const saving = rowId != null && invoiceEditSavingId === rowId;
                          return (
                            <tr
                              key={rowId ?? `inv-row-${i}`}
                              className="hover:bg-amber-50/80"
                            >
                              <td className="px-3 py-2 align-middle">
                                {rowId ? (
                                  <input
                                    type="checkbox"
                                    checked={selectedInvoiceIdSet.has(rowId)}
                                    disabled={deletingInvoiceIdSet.has(rowId)}
                                    onChange={(e) => {
                                      setSelectedInvoiceIds((prev) => {
                                        const next = new Set(prev);
                                        if (e.target.checked) next.add(rowId);
                                        else next.delete(rowId);
                                        return [...next];
                                      });
                                    }}
                                    className="h-4 w-4 rounded border-stone-300 text-amber-500 disabled:opacity-50"
                                    aria-label="選取此發票"
                                  />
                                ) : null}
                              </td>
                              {invoicesVisibleCols.map((k) => {
                                const v = (inv as unknown as Record<string, unknown>)[k];
                                if (!rowId) {
                                  const str =
                                    k === "專案ID" && (v == null || String(v).trim() === "")
                                      ? "—"
                                      : String(v ?? "—");
                                  return (
                                    <td key={k} className={`whitespace-nowrap px-4 py-3.5 text-sm ${k === "專案ID" ? "font-medium text-stone-900" : "text-stone-600"}`}>
                                      {str}
                                    </td>
                                  );
                                }
                                const val = v == null ? "" : String(v);
                                const inputCls =
                                  "w-full min-w-[4rem] rounded border border-stone-200 bg-white px-2 py-1 text-xs text-stone-800 placeholder:text-stone-400 focus:border-amber-500/60 focus:outline-none disabled:opacity-60";
                                if (k === "專案ID") {
                                  return (
                                    <td key={k} className="min-w-[11rem] max-w-[18rem] px-2 py-2 align-middle">
                                      <InvoiceProjectSearchSelect
                                        value={val}
                                        options={invoiceProjectOptions}
                                        disabled={saving}
                                        onChange={(projectId) => {
                                          setInvoiceEditError(null);
                                          setInvoices((prev) =>
                                            prev.map((r) => (r.id === rowId ? { ...r, 專案ID: projectId } : r))
                                          );
                                        }}
                                        onBlur={() => {
                                          void persistInvoiceRowById(rowId);
                                        }}
                                      />
                                    </td>
                                  );
                                }
                                if (k === "備註") {
                                  return (
                                    <td key={k} className="max-w-[14rem] px-2 py-2 align-top">
                                      <textarea
                                        value={val}
                                        disabled={saving}
                                        rows={2}
                                        onChange={(e) => {
                                          setInvoiceEditError(null);
                                          setInvoices((prev) =>
                                            prev.map((r) => (r.id === rowId ? { ...r, 備註: e.target.value } : r))
                                          );
                                        }}
                                        onBlur={() => {
                                          void persistInvoiceRowById(rowId);
                                        }}
                                        className={`${inputCls} max-w-full resize-y`}
                                      />
                                    </td>
                                  );
                                }
                                const wide = k === "發票號碼";
                                return (
                                  <td key={k} className={`px-2 py-2 align-middle ${wide ? "min-w-[7rem] max-w-[11rem]" : "min-w-[4.5rem] max-w-[8rem]"}`}>
                                    <input
                                      type="text"
                                      value={val}
                                      disabled={saving}
                                      onChange={(e) => {
                                        setInvoiceEditError(null);
                                        setInvoices((prev) =>
                                          prev.map((r) => (r.id === rowId ? { ...r, [k]: e.target.value } : r))
                                        );
                                      }}
                                      onBlur={() => {
                                        void persistInvoiceRowById(rowId);
                                      }}
                                      className={inputCls}
                                    />
                                  </td>
                                );
                              })}
                              <td className="whitespace-nowrap px-3 py-2 text-right align-middle">
                                {rowId ? (
                                  <button
                                    type="button"
                                    disabled={deletingInvoiceIdSet.has(rowId)}
                                    onClick={() => void deleteInvoicesByIdList([rowId])}
                                    className="rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-50"
                                  >
                                    {deletingInvoiceIdSet.has(rowId) ? "刪除中…" : "刪除"}
                                  </button>
                                ) : null}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                )}
              </div>
              {searchedInvoices.length > visibleInvoicesRows.length && (
                <p className="mt-2 text-right text-xs text-stone-500">載入中 {visibleInvoicesRows.length} / {searchedInvoices.length}</p>
              )}
            </>
          )}

          {financeSubTab === "payments" && (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  disabled={savingPayments}
                  onClick={async () => {
                    setPaymentEditError(null);
                    setPaymentRecordsSearch("");
                    setSavingPayments(true);
                    try {
                      const res = await fetch("/api/finance-payments", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ payments: [emptyPaymentRecordDraftRow()], allowBlank: true }),
                      });
                      const data = (await safeResJson(res)) as { ok?: boolean; error?: string; payments?: PaymentRecordRow[] };
                      if (!res.ok || !data.ok || !data.payments?.length) {
                        setPaymentEditError(data.error ?? "新增空白列失敗");
                        return;
                      }
                      setPaymentRecords((prev) => [...data.payments!, ...prev]);
                    } catch (err: unknown) {
                      setPaymentEditError(err instanceof Error ? err.message : "新增空白列失敗");
                    } finally {
                      setSavingPayments(false);
                    }
                  }}
                  className="rounded-xl border border-emerald-500/70 bg-emerald-500 px-4 py-2 text-xs font-bold text-white shadow-sm shadow-emerald-200/40 transition hover:bg-emerald-400 disabled:opacity-60"
                >
                  {savingPayments ? "新增中…" : "+ 新增空白列"}
                </button>
                <input
                  type="text"
                  value={paymentRecordsSearch}
                  onChange={(e) => setPaymentRecordsSearch(e.target.value)}
                  placeholder="搜尋發票號碼、付款專案、付款對象…"
                  className="w-full min-w-0 max-w-72 rounded-full border border-stone-200 bg-stone-50 px-3.5 py-1.5 text-xs text-stone-800 placeholder:text-stone-500 focus:border-amber-500/60 focus:outline-none"
                />
              </div>
              {paymentEditError && (
                <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{paymentEditError}</p>
              )}
              {paymentRecords.length > 0 && (
                <p className="mb-2 text-[11px] text-stone-500">
                  各欄可直接編輯；離開欄位時才會儲存。欄位比照付款表：發票號碼、付款日期、付款專案、付款對象、付款金額。
                </p>
              )}
              <div className="overflow-x-auto rounded-xl border border-stone-200/90">
                {paymentRecords.length === 0 ? (
                  <p className="px-4 py-8 text-center text-stone-500">尚無付款記錄</p>
                ) : (
                  <table className="min-w-full divide-y divide-stone-200">
                    <thead className="bg-emerald-800">
                      <tr>
                        <th className="px-3 py-3 text-left text-xs font-bold uppercase tracking-wider text-white">No.</th>
                        {paymentRecordsVisibleCols.map((k) => (
                          <th key={k} className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-white">
                            {tableColumnLabels.paymentRecords?.[k] ?? k}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-200 bg-white">
                      {searchedPaymentRecords.length === 0 ? (
                        <tr>
                          <td colSpan={(paymentRecordsVisibleCols.length || 6) + 1} className="px-4 py-8 text-center text-base font-medium text-stone-500">
                            沒有符合搜尋結果
                          </td>
                        </tr>
                      ) : (
                        visiblePaymentRecordsRows.map((payment, i) => {
                          const rowId = typeof payment.id === "string" && payment.id ? payment.id : null;
                          const saving = rowId != null && paymentEditSavingId === rowId;
                          return (
                            <tr key={rowId ?? `payment-row-${i}`} className="odd:bg-white even:bg-stone-50 hover:bg-emerald-50/70">
                              <td className="whitespace-nowrap px-3 py-2 text-xs font-medium text-stone-500">{i + 1}</td>
                              {paymentRecordsVisibleCols.map((k) => {
                                const v = (payment as unknown as Record<string, unknown>)[k];
                                const val = v == null ? "" : String(v);
                                if (!rowId) {
                                  return (
                                    <td key={k} className="whitespace-nowrap px-4 py-3 text-sm text-stone-600">
                                      {val || "—"}
                                    </td>
                                  );
                                }
                                const inputCls =
                                  "w-full min-w-[7rem] rounded border border-stone-200 bg-white px-2 py-1 text-xs text-stone-800 placeholder:text-stone-400 focus:border-emerald-500/60 focus:outline-none disabled:opacity-60";
                                if (k === "付款專案") {
                                  return (
                                    <td key={k} className="min-w-[12rem] px-2 py-2 align-middle">
                                      <InvoiceProjectSearchSelect
                                        value={val}
                                        options={invoiceProjectOptions}
                                        disabled={saving}
                                        onChange={(projectId) => {
                                          setPaymentEditError(null);
                                          setPaymentRecords((prev) =>
                                            prev.map((r) => (r.id === rowId ? { ...r, 付款專案: projectId } : r))
                                          );
                                        }}
                                        onBlur={() => void persistPaymentRecordById(rowId)}
                                      />
                                    </td>
                                  );
                                }
                                if (k === "備註") {
                                  return (
                                    <td key={k} className="min-w-[12rem] max-w-[18rem] px-2 py-2 align-top">
                                      <textarea
                                        value={val}
                                        disabled={saving}
                                        rows={2}
                                        onChange={(e) => {
                                          setPaymentEditError(null);
                                          setPaymentRecords((prev) =>
                                            prev.map((r) => (r.id === rowId ? { ...r, 備註: e.target.value } : r))
                                          );
                                        }}
                                        onBlur={() => void persistPaymentRecordById(rowId)}
                                        className={`${inputCls} max-w-full resize-y`}
                                      />
                                    </td>
                                  );
                                }
                                return (
                                  <td key={k} className={`px-2 py-2 align-middle ${k === "付款專案" || k === "付款對象" ? "min-w-[12rem]" : "min-w-[8rem]"}`}>
                                    <input
                                      type={k === "付款日期" ? "date" : "text"}
                                      value={k === "付款日期" ? normalizeDateForInput(val) : val}
                                      disabled={saving}
                                      onChange={(e) => {
                                        setPaymentEditError(null);
                                        setPaymentRecords((prev) =>
                                          prev.map((r) => (r.id === rowId ? { ...r, [k]: e.target.value } : r))
                                        );
                                      }}
                                      onBlur={() => void persistPaymentRecordById(rowId)}
                                      className={inputCls}
                                    />
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                )}
              </div>
              {searchedPaymentRecords.length > visiblePaymentRecordsRows.length && (
                <p className="mt-2 text-right text-xs text-stone-500">載入中 {visiblePaymentRecordsRows.length} / {searchedPaymentRecords.length}</p>
              )}
            </>
          )}
        </section>
        )}
          </div>
        )}
      </div>
      </div>

      {/* 新增發票（可批次多列） */}
      {showInvoiceCreateModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-stone-900/30 p-4 backdrop-blur-sm">
          <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-stone-200/90 bg-white shadow-2xl ring-1 ring-stone-200/80">
            <header className="flex shrink-0 flex-wrap items-start justify-between gap-2 border-b border-stone-200/90 bg-stone-100/90 px-4 py-3 sm:px-6">
              <div className="min-w-0">
                <h2 className="text-lg font-bold tracking-tight text-stone-900 sm:text-xl">新增發票</h2>
                <p className="mt-0.5 text-xs text-stone-500">
                  可一次建立多筆；每列須填發票號碼，空白列會自動略過。專案ID 可留空。
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowInvoiceCreateModal(false);
                  setInvoiceCreateError(null);
                }}
                className="shrink-0 rounded-xl border border-stone-300 bg-stone-50 px-3 py-1.5 text-sm font-semibold text-stone-600 hover:bg-stone-100"
              >
                關閉
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-auto px-3 py-3 sm:px-6">
              {invoiceCreateError && (
                <p className="mb-3 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-800">{invoiceCreateError}</p>
              )}
              <div className="mb-4 rounded-xl border border-amber-200/90 bg-gradient-to-br from-amber-50/90 to-stone-50/80 p-3 sm:p-4">
                <p className="mb-2 text-xs font-bold text-amber-900">連號快速填寫</p>
                <p className="mb-3 text-[11px] leading-relaxed text-stone-600">
                  設定前綴與數字規則後，可一次加入多列或只填入「發票號碼仍空白」的列。設定會記在這台瀏覽器，下次開啟會帶入建議起號。
                </p>
                <div className="flex flex-wrap items-end gap-2 sm:gap-3">
                  <div>
                    <label className="mb-0.5 block text-[10px] font-semibold text-stone-500">前綴（可空）</label>
                    <input
                      type="text"
                      value={invoiceSeqPrefix}
                      onChange={(e) => setInvoiceSeqPrefix(e.target.value)}
                      placeholder="如 AB"
                      className="w-[6.5rem] rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-xs text-stone-900"
                    />
                  </div>
                  <div>
                    <label className="mb-0.5 block text-[10px] font-semibold text-stone-500">起始數字</label>
                    <input
                      type="number"
                      min={0}
                      value={invoiceSeqStart}
                      onChange={(e) => setInvoiceSeqStart(e.target.value)}
                      className="w-24 rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-xs text-stone-900"
                    />
                  </div>
                  <div>
                    <label className="mb-0.5 block text-[10px] font-semibold text-stone-500">筆數</label>
                    <input
                      type="number"
                      min={1}
                      max={200}
                      value={invoiceSeqCount}
                      onChange={(e) => setInvoiceSeqCount(e.target.value)}
                      className="w-16 rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-xs text-stone-900"
                    />
                  </div>
                  <div>
                    <label className="mb-0.5 block text-[10px] font-semibold text-stone-500">數字補零位數</label>
                    <input
                      type="number"
                      min={0}
                      max={32}
                      placeholder="空＝不補"
                      value={invoiceSeqPad}
                      onChange={(e) => setInvoiceSeqPad(e.target.value)}
                      className="w-20 rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-xs text-stone-900"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const padRaw = invoiceSeqPad.trim();
                      const padDigits = padRaw === "" ? 0 : Math.min(32, Math.max(0, parseInt(padRaw, 10) || 0));
                      const start = parseInt(String(invoiceSeqStart).trim(), 10);
                      const count = Math.min(200, Math.max(1, parseInt(String(invoiceSeqCount).trim(), 10) || 1));
                      if (!Number.isFinite(start) || start < 0) {
                        setInvoiceCreateError("請填有效起始數字（≥0）");
                        return;
                      }
                      const nums = buildSequentialInvoiceNumbers(invoiceSeqPrefix, start, count, padDigits);
                      const newRows = nums.map((發票號碼) => ({ ...emptyInvoiceDraftRow(), 發票號碼 }));
                      setInvoiceDraftRows((prev) => [...prev, ...newRows]);
                      const nextStart = start + count;
                      setInvoiceSeqStart(String(nextStart));
                      setInvoiceCreateError(null);
                      try {
                        localStorage.setItem(LS_INVOICE_NEXT, String(nextStart));
                        localStorage.setItem(LS_INVOICE_PREFIX, invoiceSeqPrefix);
                        localStorage.setItem(LS_INVOICE_PAD, invoiceSeqPad);
                      } catch {
                        /* ignore */
                      }
                    }}
                    className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-bold text-slate-900 shadow-sm hover:bg-amber-400"
                  >
                    加入連號列
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const padRaw = invoiceSeqPad.trim();
                      const padDigits = padRaw === "" ? 0 : Math.min(32, Math.max(0, parseInt(padRaw, 10) || 0));
                      let n = parseInt(String(invoiceSeqStart).trim(), 10);
                      if (!Number.isFinite(n) || n < 0) {
                        setInvoiceCreateError("請填有效起始數字（≥0）");
                        return;
                      }
                      const prefix = invoiceSeqPrefix.trim();
                      let filled = 0;
                      setInvoiceDraftRows((prev) => {
                        const mapped = prev.map((row) => {
                          if (String(row.發票號碼 ?? "").trim() !== "") return row;
                          const numStr = padDigits > 0 ? String(n).padStart(padDigits, "0") : String(n);
                          n += 1;
                          filled += 1;
                          return { ...row, 發票號碼: `${prefix}${numStr}` };
                        });
                        return mapped;
                      });
                      if (filled === 0) {
                        setInvoiceCreateError("沒有「發票號碼為空白」的列可填入，請先新增空白列或使用上方加入連號列。");
                        return;
                      }
                      setInvoiceSeqStart(String(n));
                      setInvoiceCreateError(null);
                      try {
                        localStorage.setItem(LS_INVOICE_NEXT, String(n));
                        localStorage.setItem(LS_INVOICE_PREFIX, invoiceSeqPrefix);
                        localStorage.setItem(LS_INVOICE_PAD, invoiceSeqPad);
                      } catch {
                        /* ignore */
                      }
                    }}
                    className="rounded-lg border border-amber-600/40 bg-white px-3 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-50"
                  >
                    只填空白列
                  </button>
                </div>
                <p className="mt-2 text-[10px] text-stone-500">
                  例：前綴空白、起始 1、筆數 3、補零 8 → 00000001、00000002、00000003。例：前綴 SDH-、起始 100、不補零 → SDH-100、SDH-101…
                </p>
              </div>
              <div className="overflow-x-auto rounded-lg border border-stone-200/90">
                <table className="min-w-[920px] w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-stone-100 text-left">
                      {INVOICE_DRAFT_KEYS.map((k) => (
                        <th
                          key={k}
                          className="whitespace-nowrap border-b border-stone-200 px-2 py-2 font-semibold text-stone-600"
                        >
                          {tableColumnLabels.invoices?.[k] ?? k}
                        </th>
                      ))}
                      <th className="w-14 border-b border-stone-200 px-1 py-2 text-center font-semibold text-stone-500">　</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoiceDraftRows.map((row, rowIdx) => (
                      <tr key={rowIdx} className="bg-white">
                        {INVOICE_DRAFT_KEYS.map((k) => (
                          <td key={k} className="border-b border-stone-100 p-1 align-top">
                            {k === "專案ID" ? (
                              <InvoiceProjectSearchSelect
                                value={row[k] ?? ""}
                                options={invoiceProjectOptions}
                                onChange={(projectId) => {
                                  setInvoiceDraftRows((prev) => {
                                    const next = [...prev];
                                    next[rowIdx] = { ...next[rowIdx], [k]: projectId };
                                    return next;
                                  });
                                }}
                              />
                            ) : (
                              <input
                                type="text"
                                value={row[k] ?? ""}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setInvoiceDraftRows((prev) => {
                                    const next = [...prev];
                                    next[rowIdx] = { ...next[rowIdx], [k]: v };
                                    return next;
                                  });
                                }}
                                className="w-full min-w-[5rem] rounded border border-stone-200 bg-stone-50 px-1.5 py-1.5 text-stone-900 focus:border-amber-400/70 focus:outline-none"
                              />
                            )}
                          </td>
                        ))}
                        <td className="border-b border-stone-100 p-1 text-center align-top">
                          <button
                            type="button"
                            disabled={invoiceDraftRows.length <= 1}
                            onClick={() => setInvoiceDraftRows((prev) => prev.filter((_, j) => j !== rowIdx))}
                            className="text-[11px] font-medium text-stone-400 hover:text-red-600 disabled:opacity-30"
                          >
                            刪列
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                onClick={() => setInvoiceDraftRows((prev) => [...prev, emptyInvoiceDraftRow()])}
                className="mt-3 rounded-lg border border-dashed border-stone-300 bg-stone-50/80 px-3 py-2 text-xs font-semibold text-stone-600 transition hover:border-amber-400 hover:bg-amber-50 hover:text-amber-900"
              >
                + 新增一列
              </button>
            </div>
            <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-stone-200/90 bg-stone-50/90 px-4 py-3 sm:px-6">
              <button
                type="button"
                onClick={() => {
                  setShowInvoiceCreateModal(false);
                  setInvoiceCreateError(null);
                }}
                className="rounded-xl border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-600 hover:bg-stone-100"
              >
                取消
              </button>
              <button
                type="button"
                disabled={savingInvoices}
                onClick={async () => {
                  setInvoiceCreateError(null);
                  setSavingInvoices(true);
                  try {
                    const res = await fetch("/api/invoices", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ invoices: invoiceDraftRows }),
                    });
                    const data = (await safeResJson(res)) as { ok?: boolean; error?: string; invoices?: InvoiceRow[] };
                    if (!res.ok || !data.ok) {
                      setInvoiceCreateError(data.error ?? "新增失敗");
                      setSavingInvoices(false);
                      return;
                    }
                    if (data.invoices?.length) {
                      setInvoices((prev) => [...data.invoices!, ...prev]);
                    } else {
                      await refreshDashboardData(["invoices", "finance"]);
                    }
                    try {
                      localStorage.setItem(LS_INVOICE_PREFIX, invoiceSeqPrefix);
                      localStorage.setItem(LS_INVOICE_PAD, invoiceSeqPad);
                      localStorage.setItem(LS_INVOICE_NEXT, invoiceSeqStart);
                    } catch {
                      /* ignore */
                    }
                    setShowInvoiceCreateModal(false);
                  } catch (err: unknown) {
                    setInvoiceCreateError(err instanceof Error ? err.message : "新增失敗");
                  }
                  setSavingInvoices(false);
                }}
                className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-slate-900 shadow shadow-amber-200/30 transition hover:bg-amber-400 disabled:opacity-50"
              >
                {savingInvoices ? "儲存中…" : "儲存"}
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* 貼上匯入發票（Google Sheet / CSV） */}
      {showInvoicePasteImportModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-stone-900/30 p-4 backdrop-blur-sm">
          <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-stone-200/90 bg-white shadow-2xl ring-1 ring-stone-200/80">
            <header className="flex shrink-0 flex-wrap items-start justify-between gap-2 border-b border-stone-200/90 bg-stone-100/90 px-4 py-3 sm:px-6">
              <div className="min-w-0">
                <h2 className="text-lg font-bold tracking-tight text-stone-900 sm:text-xl">貼上匯入發票</h2>
                <p className="mt-0.5 text-xs text-stone-500">
                  從 Google Sheet 複製含標題列的範圍後貼上。系統會自動對應同名與常見欄位，例如「發票開立日」、「收款日期」、「收款金額」。
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowInvoicePasteImportModal(false);
                  setInvoiceCreateError(null);
                }}
                className="shrink-0 rounded-xl border border-stone-300 bg-stone-50 px-3 py-1.5 text-sm font-semibold text-stone-600 hover:bg-stone-100"
              >
                關閉
              </button>
            </header>
            <div className="min-h-0 flex-1 space-y-4 overflow-auto px-3 py-3 sm:px-6">
              {invoiceCreateError && (
                <p className="rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-800">{invoiceCreateError}</p>
              )}
              <div>
                <label className="mb-1.5 block text-xs font-bold text-stone-600">貼上 Google Sheet / CSV 內容</label>
                <textarea
                  value={invoicePasteText}
                  onChange={(e) => {
                    setInvoiceCreateError(null);
                    setInvoicePasteText(e.target.value);
                  }}
                  rows={8}
                  placeholder={"發票號碼\t發票開立日\t收款對象\t收款金額\t收款日期\nAB12345678\t2026/01/01\t某某公司\t10000\t2026/01/15"}
                  className="w-full rounded-xl border border-stone-300 bg-stone-50 px-3 py-2 text-xs font-medium text-stone-900 placeholder:text-stone-400 focus:border-amber-400/70 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                />
              </div>

              {invoicePasteText.trim() !== "" && (
                <div className="space-y-3">
                  {invoicePasteImport.error && (
                    <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{invoicePasteImport.error}</p>
                  )}
                  <div className="rounded-xl border border-stone-200/90 bg-stone-50/80 p-3">
                    <p className="mb-2 text-xs font-bold text-stone-700">欄位對應</p>
                    <div className="flex flex-wrap gap-2">
                      {invoicePasteImport.headers.map((header, idx) => {
                        const mapped = invoicePasteImport.mappedKeys[idx];
                        return (
                          <span
                            key={`${header}-${idx}`}
                            className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                              mapped
                                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                : "border-stone-200 bg-white text-stone-400"
                            }`}
                          >
                            {header || `第 ${idx + 1} 欄`} → {mapped || "略過"}
                          </span>
                        );
                      })}
                    </div>
                    <p className="mt-2 text-[11px] text-stone-500">
                      解析到 {invoicePasteImport.rows.length} 筆資料。未對應欄位會略過；發票號碼空白的列不會被後端新增。
                    </p>
                  </div>

                  {invoicePasteImport.rows.length > 0 && (
                    <div className="overflow-x-auto rounded-xl border border-stone-200/90">
                      <table className="min-w-[820px] w-full border-collapse text-xs">
                        <thead className="bg-stone-100">
                          <tr>
                            {INVOICE_DRAFT_KEYS.map((key) => (
                              <th key={key} className="whitespace-nowrap border-b border-stone-200 px-2 py-2 text-left font-semibold text-stone-600">
                                {tableColumnLabels.invoices?.[key] ?? key}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {invoicePasteImport.rows.slice(0, 20).map((row, rowIdx) => (
                            <tr key={rowIdx} className="odd:bg-white even:bg-stone-50">
                              {INVOICE_DRAFT_KEYS.map((key) => (
                                <td key={key} className="max-w-[14rem] truncate border-b border-stone-100 px-2 py-2 text-stone-700" title={row[key] || undefined}>
                                  {row[key] || "—"}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {invoicePasteImport.rows.length > 20 && (
                        <p className="px-3 py-2 text-right text-[11px] text-stone-500">只預覽前 20 筆，共 {invoicePasteImport.rows.length} 筆</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-stone-200/90 bg-stone-50/90 px-4 py-3 sm:px-6">
              <button
                type="button"
                onClick={() => {
                  setShowInvoicePasteImportModal(false);
                  setInvoiceCreateError(null);
                }}
                className="rounded-xl border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-600 hover:bg-stone-100"
              >
                取消
              </button>
              <button
                type="button"
                disabled={savingInvoices || invoicePasteImport.rows.length === 0 || Boolean(invoicePasteImport.error)}
                onClick={async () => {
                  setInvoiceCreateError(null);
                  setSavingInvoices(true);
                  try {
                    const res = await fetch("/api/invoices", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ invoices: invoicePasteImport.rows }),
                    });
                    const data = (await safeResJson(res)) as { ok?: boolean; error?: string; invoices?: InvoiceRow[] };
                    if (!res.ok || !data.ok) {
                      setInvoiceCreateError(data.error ?? "匯入失敗");
                      setSavingInvoices(false);
                      return;
                    }
                    if (data.invoices?.length) {
                      setInvoices((prev) => [...data.invoices!, ...prev]);
                    } else {
                      await refreshDashboardData(["invoices", "finance"]);
                    }
                    setShowInvoicePasteImportModal(false);
                    setInvoicePasteText("");
                  } catch (err: unknown) {
                    setInvoiceCreateError(err instanceof Error ? err.message : "匯入失敗");
                  }
                  setSavingInvoices(false);
                }}
                className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-slate-900 shadow shadow-amber-200/30 transition hover:bg-amber-400 disabled:opacity-50"
              >
                {savingInvoices ? "匯入中…" : `確認匯入 ${invoicePasteImport.rows.length} 筆`}
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* 新增付款記錄（可批次多列） */}
      {showPaymentCreateModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-stone-900/30 p-4 backdrop-blur-sm">
          <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-stone-200/90 bg-white shadow-2xl ring-1 ring-stone-200/80">
            <header className="flex shrink-0 flex-wrap items-start justify-between gap-2 border-b border-stone-200/90 bg-stone-100/90 px-4 py-3 sm:px-6">
              <div className="min-w-0">
                <h2 className="text-lg font-bold tracking-tight text-stone-900 sm:text-xl">新增付款記錄</h2>
                <p className="mt-0.5 text-xs text-stone-500">
                  可一次建立多筆；比照付款表欄位填寫發票號碼、付款日期、付款專案、付款對象與付款金額。
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowPaymentCreateModal(false);
                  setPaymentCreateError(null);
                }}
                className="shrink-0 rounded-xl border border-stone-300 bg-stone-50 px-3 py-1.5 text-sm font-semibold text-stone-600 hover:bg-stone-100"
              >
                關閉
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-auto px-3 py-3 sm:px-6">
              {paymentCreateError && (
                <p className="mb-3 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-800">{paymentCreateError}</p>
              )}
              <div className="overflow-x-auto rounded-lg border border-stone-200/90">
                <table className="min-w-[760px] w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-emerald-800 text-left">
                      {PAYMENT_RECORD_KEYS.map((k) => (
                        <th key={k} className="whitespace-nowrap border-b border-emerald-900/30 px-2 py-2 font-semibold text-white">
                          {tableColumnLabels.paymentRecords?.[k] ?? k}
                        </th>
                      ))}
                      <th className="w-14 border-b border-emerald-900/30 px-1 py-2 text-center font-semibold text-white">　</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paymentDraftRows.map((row, rowIdx) => (
                      <tr key={rowIdx} className="bg-white">
                        {PAYMENT_RECORD_KEYS.map((k) => (
                          <td key={k} className="border-b border-stone-100 p-1 align-top">
                            <input
                              type={k === "付款日期" ? "date" : "text"}
                              value={row[k] ?? ""}
                              onChange={(e) => {
                                const v = e.target.value;
                                setPaymentDraftRows((prev) => {
                                  const next = [...prev];
                                  next[rowIdx] = { ...next[rowIdx], [k]: v };
                                  return next;
                                });
                              }}
                              className="w-full min-w-[5rem] rounded border border-stone-200 bg-stone-50 px-1.5 py-1.5 text-stone-900 focus:border-emerald-500/70 focus:outline-none"
                            />
                          </td>
                        ))}
                        <td className="border-b border-stone-100 p-1 text-center align-top">
                          <button
                            type="button"
                            disabled={paymentDraftRows.length <= 1}
                            onClick={() => setPaymentDraftRows((prev) => prev.filter((_, j) => j !== rowIdx))}
                            className="text-[11px] font-medium text-stone-400 hover:text-red-600 disabled:opacity-30"
                          >
                            刪列
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                onClick={() => setPaymentDraftRows((prev) => [...prev, emptyPaymentRecordDraftRow()])}
                className="mt-3 rounded-lg border border-dashed border-stone-300 bg-stone-50/80 px-3 py-2 text-xs font-semibold text-stone-600 transition hover:border-emerald-500 hover:bg-emerald-50 hover:text-emerald-900"
              >
                + 新增一列
              </button>
            </div>
            <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-stone-200/90 bg-stone-50/90 px-4 py-3 sm:px-6">
              <button
                type="button"
                onClick={() => {
                  setShowPaymentCreateModal(false);
                  setPaymentCreateError(null);
                }}
                className="rounded-xl border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-600 hover:bg-stone-100"
              >
                取消
              </button>
              <button
                type="button"
                disabled={savingPayments}
                onClick={async () => {
                  setPaymentCreateError(null);
                  setSavingPayments(true);
                  try {
                    const res = await fetch("/api/finance-payments", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ payments: paymentDraftRows }),
                    });
                    const data = (await safeResJson(res)) as { ok?: boolean; error?: string; payments?: PaymentRecordRow[] };
                    if (!res.ok || !data.ok) {
                      setPaymentCreateError(data.error ?? "新增失敗");
                      setSavingPayments(false);
                      return;
                    }
                    if (data.payments?.length) {
                      setPaymentRecords((prev) => [...data.payments!, ...prev]);
                    } else {
                      await refreshDashboardData(["payments"]);
                    }
                    setShowPaymentCreateModal(false);
                  } catch (err: unknown) {
                    setPaymentCreateError(err instanceof Error ? err.message : "新增失敗");
                  }
                  setSavingPayments(false);
                }}
                className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-bold text-white shadow shadow-emerald-200/30 transition hover:bg-emerald-400 disabled:opacity-50"
              >
                {savingPayments ? "儲存中…" : "儲存"}
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* 大總表 新增專案 Modal */}
      {showCreateMaster && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-stone-900/30 backdrop-blur-sm">
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
                    <SelectField
                      label="專案類型"
                      value={createForm.專案類型}
                      onChange={(v) =>
                        setCreateForm((f) => {
                          const autoCost = costFromTotalByProjectType(v, f.專案總金額未稅);
                          const nextCost = autoCost != null ? autoCost : f.專案成本;
                          return {
                            ...f,
                            專案類型: v,
                            專案成本: nextCost,
                            專案營收: calc專案營收(f.專案總金額未稅, nextCost, f.KOL費用未稅),
                          };
                        })
                      }
                      options={projectTypesOptions}
                    />
                    <SelectField
                      label="專案狀態"
                      value={createForm.專案狀態}
                      onChange={(v) => setCreateForm((f) => ({ ...f, 專案狀態: v }))}
                      options={[...new Set([...projectStatusOptions, createForm.專案狀態].filter(Boolean))]}
                    />
                    <div className="rounded-xl border border-stone-300 bg-stone-50 px-3 py-2.5">
                      <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-stone-700">
                        <input
                          type="checkbox"
                          checked={createForm.長期案}
                          onChange={(e) => setCreateForm((f) => ({ ...f, 長期案: e.target.checked }))}
                          className="h-4 w-4 rounded border-stone-300 text-amber-500 focus:ring-amber-500/40"
                        />
                        長期案（定期請款）
                      </label>
                    </div>
                    <DateField label="開案日期" value={createForm.開案日期} onChange={(v) => setCreateForm((f) => ({ ...f, 開案日期: v }))} />
                    <DateField label="狀態確認日期" value={createForm.狀態確認日期} onChange={(v) => setCreateForm((f) => ({ ...f, 狀態確認日期: v }))} />
                    <DateField
                      label="廠商預計付款日"
                      value={createForm.廠商預計付款日}
                      onChange={(v) => setCreateForm((f) => ({ ...f, 廠商預計付款日: v }))}
                    />
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
                        setCreateForm((f) => {
                          const autoCost = costFromTotalByProjectType(f.專案類型, v);
                          const nextCost = autoCost != null ? autoCost : f.專案成本;
                          return {
                            ...f,
                            專案總金額未稅: v,
                            專案成本: nextCost,
                            專案營收: calc專案營收(v, nextCost, f.KOL費用未稅),
                          };
                        })
                      }
                    />
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-stone-500">專案營收</label>
                      <div className="w-full rounded-xl border border-stone-300 bg-stone-50 px-3 py-2.5 text-sm font-medium text-stone-600 tabular-nums">
                        {formatAmount(createForm.專案營收)}
                      </div>
                      <p className="mt-1 text-xs text-stone-500">自動計算：專案總金額未稅 − 專案成本 − KOL費用未稅</p>
                    </div>
                    <div>
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
                      {costFromTotalByProjectType(createForm.專案類型, createForm.專案總金額未稅) != null ? (
                        <p className="mt-1 text-xs text-stone-500">此專案類型：專案成本 = 專案總金額未稅 × 70%（可手動修改）</p>
                      ) : null}
                    </div>
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
                    {isPayoutModeB(createForm.專案類型) && createForm.KOL名稱.trim() ? (
                      <>
                        <Field label="自來件分潤%數（由 KOL 帶出）" value={createMasterSelectedPartner?.自來件分潤} />
                        <Field label="SDH開發件分潤%數（由 KOL 帶出）" value={createMasterSelectedPartner?.["SDH開發分件分潤"]} />
                      </>
                    ) : null}
                    <SelectField
                      label="專案費用類型"
                      value={createForm.專案費用類型}
                      onChange={(v) => setCreateForm((f) => ({ ...f, 專案費用類型: v }))}
                      options={[...new Set([...projectExpenseTypeOptions, createForm.專案費用類型].filter(Boolean))].sort((a, b) =>
                        a.localeCompare(b, "zh-TW")
                      )}
                      className="col-span-2"
                    />
                  </div>
                </section>

                <section>
                  <h3 className="mb-3 text-base font-bold text-amber-800">人員與分潤設定</h3>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                    <SearchableSelectField
                      label="KOL名稱"
                      value={createForm.KOL名稱}
                      onChange={(v) => setCreateForm((f) => ({ ...f, KOL名稱: v }))}
                      options={kolNameOptionsFromDb}
                      searchPlaceholder="搜尋 KOL…"
                      emptyHint="尚無合作夥伴資料時請先至「合作夥伴」新增已核准 KOL"
                    />
                    <InputField label="廠商名稱" value={createForm.廠商名稱} onChange={(v) => setCreateForm((f) => ({ ...f, 廠商名稱: v }))} />
                    {isPayoutModeB(createForm.專案類型) ? (
                      <>
                        <SelectField
                          label="專案開發人"
                          value={createForm.專案開發人}
                          onChange={(v) => setCreateForm((f) => ({ ...f, 專案開發人: v }))}
                          options={userNames}
                        />
                        <SelectField
                          label="經紀人"
                          value={createForm.經紀人}
                          onChange={(v) => setCreateForm((f) => ({ ...f, 經紀人: v }))}
                          options={[...new Set([...userNames, createForm.經紀人].filter(Boolean))]}
                        />
                        <Field label="主管（由 KOL 帶出）" value={partners.find((p) => p.合作夥伴名稱 === createForm.KOL名稱)?.主管 ?? "—"} />
                        <Field label="KOL開發者（由 KOL 帶出）" value={partners.find((p) => p.合作夥伴名稱 === createForm.KOL名稱)?.KOL開發者 ?? "—"} />
                      </>
                    ) : (
                      <>
                        <SelectField label="專案BDPM" value={createForm.專案BDPM} onChange={(v) => setCreateForm((f) => ({ ...f, 專案BDPM: v }))} options={userNames} />
                        <SelectField
                          label="專案引薦人"
                          value={createForm.專案引薦人}
                          onChange={(v) => setCreateForm((f) => ({ ...f, 專案引薦人: v }))}
                          options={userNames}
                        />
                        <SelectField
                          label="專案管理員"
                          value={createForm.專案管理員}
                          onChange={(v) => setCreateForm((f) => ({ ...f, 專案管理員: v }))}
                          options={userNames}
                        />
                        <SelectField
                          label="執行管理員"
                          value={createForm.執行管理員}
                          onChange={(v) => setCreateForm((f) => ({ ...f, 執行管理員: v }))}
                          options={userNames}
                        />
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
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-stone-900/30 backdrop-blur-sm p-4">
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
                    className="relative z-[25]"
                    label="角色"
                    value={displayRoles.includes(editUserForm.role) ? editUserForm.role : (displayRoles[0] ?? "")}
                    onChange={(v) => setEditUserForm((f) => ({ ...f, role: v }))}
                    options={[...displayRoles]}
                  />
                  <div>
                    <InputField label="部門（選填）" value={editUserForm.dept} onChange={(v) => setEditUserForm((f) => ({ ...f, dept: v }))} />
                    <p className="mt-1 text-xs leading-relaxed text-stone-500">內部備註用，可留空；職位請改「角色」。</p>
                  </div>
                  {editUserForm.role === "KOL" ? (
                    <div className="sm:col-span-2">
                      <SearchableSelectField
                        label="責任範圍：綁定合作夥伴 (PartnerID)"
                        value={kolScopeButtonLabel(editUserForm.scope, kolPartnerScopeOptions)}
                        onChange={(v) =>
                          setEditUserForm((f) => ({ ...f, scope: v ? parseKolPartnerOptionToScope(v) : "" }))
                        }
                        options={kolPartnerScopeOptions}
                        searchPlaceholder="搜尋編號或 KOL 名稱…"
                        emptyHint="尚無合作夥伴時請先到「合作夥伴」新增（核准後才會出現）"
                      />
                      <p className="mt-1 text-xs leading-relaxed text-stone-500">
                        選填：選取後寫入 PartnerID。可不選，改以 Email 對應合作夥伴。
                      </p>
                    </div>
                  ) : (
                    <div className="sm:col-span-2">
                      <InputField label="責任範圍 (scope)" value={editUserForm.scope} onChange={(v) => setEditUserForm((f) => ({ ...f, scope: v }))} />
                      <p className="mt-1 text-xs leading-relaxed text-stone-500">經紀人常見：主管、* 或留空。</p>
                    </div>
                  )}
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
                        overview_kpis: null,
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
        <>
        <div className="fixed inset-0 z-[60] flex items-start justify-end bg-stone-900/30 backdrop-blur-sm">
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
              <div className="flex flex-wrap items-center justify-end gap-2">
                {me?.role === "董事長" && (
                  <button
                    type="button"
                    onClick={() => {
                      setSaveMasterError(null);
                      setShowDeleteMasterConfirm(true);
                    }}
                    className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-800 transition hover:bg-red-100"
                  >
                    刪除專案
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (!isEditingMaster) {
                      setIsEditingMaster(true);
                      setSaveMasterError(null);
                      void refreshDashboardData(["partners"]);
                      return;
                    }
                    // 取消編輯 → 還原為目前 selectedMaster 的值
                    setIsEditingMaster(false);
                    setSaveMasterError(null);
                    setEditMasterForm({
                      專案名稱: selectedMaster.專案名稱 ?? "",
                      專案類型: selectedMaster.專案類型 ?? "",
                      專案狀態: selectedMaster.專案狀態 ?? "",
                      長期案: Boolean(selectedMaster.長期案),
                      狀態確認日期: normalizeDateForInput(selectedMaster.狀態確認日期),
                      開案日期: normalizeDateForInput(selectedMaster.開案日期),
                      廠商預計付款日: normalizeDateForInput(selectedMaster.廠商預計付款日),
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
                      經紀人: selectedMaster.經紀人 ?? "",
                      廠商名稱: selectedMaster.廠商名稱 ?? "",
                      專案BDPM: selectedMaster.專案BDPM ?? "",
                      專案BDPM分潤成數: selectedMaster.專案BDPM分潤成數 ?? "",
                      專案引薦人: selectedMaster.專案引薦人 ?? "",
                      專案引薦人分潤成數: selectedMaster.專案引薦人分潤成數 ?? "",
                      專案開發人: selectedMaster.專案開發人 ?? "",
                      專案開發人分潤成數: selectedMaster.專案開發人分潤成數 ?? "",
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
                    setShowDeleteMasterConfirm(false);
                    setPendingDeleteMasterTaskTemplate(null);
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
                              const { 專案BDPM分潤成數, 專案引薦人分潤成數, 專案開發人分潤成數, 專案管理員分潤成數, 執行管理員分潤成數, ...rest } = editMasterForm;
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
                      onChange={(v) =>
                        setEditMasterForm((f) => {
                          const autoCost = costFromTotalByProjectType(v, f.專案總金額未稅);
                          const nextCost = autoCost != null ? autoCost : f.專案成本;
                          return {
                            ...f,
                            專案類型: v,
                            專案成本: nextCost,
                            專案營收: calc專案營收(f.專案總金額未稅, nextCost, f.KOL費用未稅),
                          };
                        })
                      }
                      options={[...new Set([...projectTypesOptions, editMasterForm.專案類型].filter(Boolean))]}
                    />
                  ) : (
                    <Field label="專案類型" value={selectedMaster.專案類型} />
                  )}
                  {isEditingMaster ? (
                    <SelectField
                      label="專案狀態"
                      value={editMasterForm.專案狀態}
                      onChange={(v) => setEditMasterForm((f) => ({ ...f, 專案狀態: v }))}
                      options={[...new Set([...projectStatusOptions, editMasterForm.專案狀態].filter(Boolean))]}
                    />
                  ) : (
                    <Field label="專案狀態" value={selectedMaster.專案狀態} />
                  )}
                  {isEditingMaster ? (
                    <div className="rounded-xl border border-stone-300 bg-stone-50 px-3 py-2.5">
                      <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-stone-700">
                        <input
                          type="checkbox"
                          checked={editMasterForm.長期案}
                          onChange={(e) => setEditMasterForm((f) => ({ ...f, 長期案: e.target.checked }))}
                          className="h-4 w-4 rounded border-stone-300 text-amber-500 focus:ring-amber-500/40"
                        />
                        長期案（定期請款）
                      </label>
                    </div>
                  ) : (
                    <Field label="長期案" value={selectedMaster.長期案 ? "是" : "否"} />
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
                    <DateField
                      label="廠商預計付款日"
                      value={editMasterForm.廠商預計付款日}
                      onChange={(v) => setEditMasterForm((f) => ({ ...f, 廠商預計付款日: v }))}
                    />
                  ) : (
                    <Field label="廠商預計付款日" value={selectedMaster.廠商預計付款日} />
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

              {(selectedMaster.長期案 || isEditingMaster) && (
                <section>
                  <h3 className="mb-3 text-base font-bold text-amber-800">長期案排程任務（MVP）</h3>
                  {!selectedMaster.長期案 && (
                    <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">請先將此專案儲存為「長期案」，再設定固定排程任務。</p>
                  )}
                  {masterTaskTemplatesError && (
                    <p className="mb-3 rounded-lg bg-amber-100/90 px-3 py-2 text-sm font-medium text-amber-800">{masterTaskTemplatesError}</p>
                  )}
                  {selectedMaster.長期案 && (
                    <div className="space-y-3">
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => setShowCreateMasterTaskTemplateForm((v) => !v)}
                          className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-semibold text-amber-800 transition hover:bg-amber-100"
                        >
                          {showCreateMasterTaskTemplateForm ? "收合新增區" : "新增排程模板"}
                        </button>
                      </div>
                      {showCreateMasterTaskTemplateForm && (
                        <div className="grid grid-cols-2 gap-3 rounded-xl border border-stone-200 bg-stone-50 p-3">
                          <InputField
                            label="任務名稱"
                            value={newMasterTaskTemplateForm.任務名稱}
                            onChange={(v) => setNewMasterTaskTemplateForm((f) => ({ ...f, 任務名稱: v }))}
                          />
                          <SelectField
                            label="負責人（可選）"
                            value={newMasterTaskTemplateForm.負責人}
                            onChange={(v) => setNewMasterTaskTemplateForm((f) => ({ ...f, 負責人: v }))}
                            options={[...new Set(["", ...userNames])]}
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <NumberField
                              label="每月幾號"
                              value={newMasterTaskTemplateForm.每月幾號}
                              onChange={(v) => setNewMasterTaskTemplateForm((f) => ({ ...f, 每月幾號: v || "1" }))}
                            />
                            <NumberField
                              label="提前天數"
                              value={newMasterTaskTemplateForm.提前天數}
                              onChange={(v) => setNewMasterTaskTemplateForm((f) => ({ ...f, 提前天數: v || "0" }))}
                            />
                          </div>
                          <div className="col-span-2">
                            <TextAreaField
                              label="備註（建立任務時帶入）"
                              value={newMasterTaskTemplateForm.備註}
                              onChange={(v) => setNewMasterTaskTemplateForm((f) => ({ ...f, 備註: v }))}
                            />
                          </div>
                          <div className="col-span-2 flex justify-end">
                            <button
                              type="button"
                              disabled={masterTaskTemplatesSaving || !newMasterTaskTemplateForm.任務名稱.trim()}
                              onClick={() => void createMasterTaskTemplateRow()}
                              className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-slate-900 transition hover:bg-amber-400 disabled:opacity-60"
                            >
                              {masterTaskTemplatesSaving ? "新增中..." : "建立模板"}
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="space-y-2">
                        {masterTaskTemplatesLoading ? (
                          <p className="text-sm text-stone-500">讀取中...</p>
                        ) : masterTaskTemplates.length === 0 ? (
                          <p className="text-sm text-stone-500">尚未設定模板。每日 cron 會依模板自動建立任務。</p>
                        ) : (
                          masterTaskTemplates.map((tpl) => (
                            <div key={tpl.id} className="rounded-xl border border-stone-200 bg-white px-3 py-2">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-semibold text-stone-800">
                                  {tpl.任務名稱} · 每月 {tpl.每月幾號} 號（提前 {tpl.提前天數} 天）
                                </p>
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setEditingMasterTaskTemplateId((prev) => (prev === tpl.id ? null : tpl.id))}
                                    className="rounded-lg bg-stone-200 px-3 py-1 text-xs font-semibold text-stone-700"
                                  >
                                    {editingMasterTaskTemplateId === tpl.id ? "收合" : "編輯"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void toggleMasterTaskTemplateEnabled(tpl)}
                                    className={`rounded-lg px-3 py-1 text-xs font-semibold ${
                                      tpl.啟用 ? "bg-emerald-100 text-emerald-800" : "bg-stone-200 text-stone-700"
                                    }`}
                                  >
                                    {tpl.啟用 ? "啟用中" : "已停用"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setPendingDeleteMasterTaskTemplate(tpl)}
                                    className="rounded-lg bg-red-100 px-3 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-200"
                                  >
                                    刪除
                                  </button>
                                </div>
                              </div>
                              <p className="mt-1 text-xs text-stone-500">
                                負責人：{tpl.負責人 || "—"}
                              </p>
                              <p className="mt-1 text-xs text-stone-500">
                                下次觸發：{computeNextTemplateTriggerDateText(tpl.每月幾號, tpl.提前天數)} ｜上次建立月份：{tpl.最後觸發鍵 || "尚未建立"}
                              </p>
                              {editingMasterTaskTemplateId === tpl.id && (
                                <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg border border-stone-100 bg-stone-50 p-2">
                                <InputField
                                  label="任務名稱"
                                  value={masterTaskTemplateDrafts[tpl.id]?.任務名稱 ?? ""}
                                  onChange={(v) =>
                                    setMasterTaskTemplateDrafts((prev) => ({
                                      ...prev,
                                      [tpl.id]: { ...(prev[tpl.id] ?? masterTaskTemplateDrafts[tpl.id]), 任務名稱: v },
                                    }))
                                  }
                                />
                                <SelectField
                                  label="負責人"
                                  value={masterTaskTemplateDrafts[tpl.id]?.負責人 ?? ""}
                                  onChange={(v) =>
                                    setMasterTaskTemplateDrafts((prev) => ({
                                      ...prev,
                                      [tpl.id]: { ...(prev[tpl.id] ?? masterTaskTemplateDrafts[tpl.id]), 負責人: v },
                                    }))
                                  }
                                  options={[...new Set(["", ...userNames])]}
                                />
                                <div className="grid grid-cols-2 gap-2">
                                  <NumberField
                                    label="每月幾號"
                                    value={masterTaskTemplateDrafts[tpl.id]?.每月幾號 ?? "1"}
                                    onChange={(v) =>
                                      setMasterTaskTemplateDrafts((prev) => ({
                                        ...prev,
                                        [tpl.id]: { ...(prev[tpl.id] ?? masterTaskTemplateDrafts[tpl.id]), 每月幾號: v || "1" },
                                      }))
                                    }
                                  />
                                  <NumberField
                                    label="提前天數"
                                    value={masterTaskTemplateDrafts[tpl.id]?.提前天數 ?? "0"}
                                    onChange={(v) =>
                                      setMasterTaskTemplateDrafts((prev) => ({
                                        ...prev,
                                        [tpl.id]: { ...(prev[tpl.id] ?? masterTaskTemplateDrafts[tpl.id]), 提前天數: v || "0" },
                                      }))
                                    }
                                  />
                                </div>
                                <div className="col-span-2">
                                  <TextAreaField
                                    label="備註"
                                    value={masterTaskTemplateDrafts[tpl.id]?.備註 ?? ""}
                                    onChange={(v) =>
                                      setMasterTaskTemplateDrafts((prev) => ({
                                        ...prev,
                                        [tpl.id]: { ...(prev[tpl.id] ?? masterTaskTemplateDrafts[tpl.id]), 備註: v },
                                      }))
                                    }
                                  />
                                </div>
                                <div className="col-span-2 flex justify-end">
                                  <button
                                    type="button"
                                    disabled={masterTaskTemplatesSaving || !(masterTaskTemplateDrafts[tpl.id]?.任務名稱 ?? "").trim()}
                                    onClick={() => void saveMasterTaskTemplateRow(tpl.id)}
                                    className="rounded-lg bg-stone-800 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-stone-700 disabled:opacity-60"
                                  >
                                    儲存模板
                                  </button>
                                </div>
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </section>
              )}

              <section>
                <h3 className="mb-3 text-base font-bold text-amber-800">金額與成本</h3>
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  {isEditingMaster ? (
                    <NumberField
                      label="專案總金額未稅"
                      value={editMasterForm.專案總金額未稅}
                      onChange={(v) =>
                        setEditMasterForm((f) => {
                          const autoCost = costFromTotalByProjectType(f.專案類型, v);
                          const nextCost = autoCost != null ? autoCost : f.專案成本;
                          return {
                            ...f,
                            專案總金額未稅: v,
                            專案成本: nextCost,
                            專案營收: calc專案營收(v, nextCost, f.KOL費用未稅),
                          };
                        })
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
                    <div>
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
                      {costFromTotalByProjectType(editMasterForm.專案類型, editMasterForm.專案總金額未稅) != null ? (
                        <p className="mt-1 text-xs text-stone-500">此專案類型：專案成本 = 專案總金額未稅 × 70%（可手動修改）</p>
                      ) : null}
                    </div>
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

                  {isPayoutModeB(isEditingMaster ? editMasterForm.專案類型 : selectedMaster.專案類型 ?? "") &&
                  String(isEditingMaster ? editMasterForm.KOL名稱 : selectedMaster.KOL名稱 ?? "").trim() ? (
                    <>
                      <Field label="自來件分潤%數（由 KOL 帶出）" value={selectedMasterPartner?.自來件分潤} />
                      <Field label="SDH開發件分潤%數（由 KOL 帶出）" value={selectedMasterPartner?.["SDH開發分件分潤"]} />
                    </>
                  ) : null}

                  {isEditingMaster ? (
                    <SelectField
                      label="專案費用類型"
                      value={editMasterForm.專案費用類型}
                      onChange={(v) => setEditMasterForm((f) => ({ ...f, 專案費用類型: v }))}
                      options={[...new Set([...projectExpenseTypeOptions, editMasterForm.專案費用類型].filter(Boolean))].sort((a, b) =>
                        a.localeCompare(b, "zh-TW")
                      )}
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
                    <SearchableSelectField
                      label="KOL名稱"
                      value={editMasterForm.KOL名稱}
                      onChange={(v) => setEditMasterForm((f) => ({ ...f, KOL名稱: v }))}
                      options={[...new Set([...kolNameOptionsFromDb, editMasterForm.KOL名稱].filter(Boolean))].sort((a, b) =>
                        a.localeCompare(b, "zh-Hant")
                      )}
                      searchPlaceholder="搜尋 KOL…"
                      emptyHint="尚無合作夥伴資料時請先至「合作夥伴」新增已核准 KOL"
                    />
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
                        <SelectField label="專案開發人" value={editMasterForm.專案開發人} onChange={(v) => setEditMasterForm((f) => ({ ...f, 專案開發人: v }))} options={userNames} />
                      ) : (
                        <Field label="專案開發人" value={selectedMaster.專案開發人} />
                      )}
                      {isEditingMaster ? (
                        <SelectField
                          label="經紀人"
                          value={editMasterForm.經紀人}
                          onChange={(v) => setEditMasterForm((f) => ({ ...f, 經紀人: v }))}
                          options={[...new Set([...userNames, editMasterForm.經紀人].filter(Boolean))]}
                        />
                      ) : (
                        <Field label="經紀人" value={selectedMaster.經紀人} />
                      )}
                      <Field label="主管（由 KOL 帶出）" value={partners.find((p) => p.合作夥伴名稱 === (isEditingMaster ? editMasterForm.KOL名稱 : selectedMaster.KOL名稱))?.主管 ?? "—"} />
                      <Field label="KOL開發者（由 KOL 帶出）" value={partners.find((p) => p.合作夥伴名稱 === (isEditingMaster ? editMasterForm.KOL名稱 : selectedMaster.KOL名稱))?.KOL開發者 ?? "—"} />
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
                      {isEditingMaster ? (
                        <SelectField label="專案引薦人" value={editMasterForm.專案引薦人} onChange={(v) => setEditMasterForm((f) => ({ ...f, 專案引薦人: v }))} options={userNames} />
                      ) : (
                        <Field label="專案引薦人" value={selectedMaster.專案引薦人} />
                      )}
                      {isEditingMaster ? (
                        <SelectField label="專案管理員" value={editMasterForm.專案管理員} onChange={(v) => setEditMasterForm((f) => ({ ...f, 專案管理員: v }))} options={userNames} />
                      ) : (
                        <Field label="專案管理員" value={selectedMaster.專案管理員} />
                      )}
                      {isEditingMaster ? (
                        <SelectField label="執行管理員" value={editMasterForm.執行管理員} onChange={(v) => setEditMasterForm((f) => ({ ...f, 執行管理員: v }))} options={userNames} />
                      ) : (
                        <Field label="執行管理員" value={selectedMaster.執行管理員} />
                      )}
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

        {showDeleteMasterConfirm && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-stone-900/50 p-4 backdrop-blur-sm">
            <div
              className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-6 shadow-2xl ring-1 ring-stone-200/80"
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-master-title"
            >
              <h3 id="delete-master-title" className="text-lg font-bold text-stone-900">
                確認刪除專案？
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-stone-600">
                將永久刪除此筆大總表資料，並一併刪除同專案ID 之任務（{masterDeleteRelatedCounts.tasks}{" "}
                筆）、分潤表列（{masterDeleteRelatedCounts.payouts} 筆）、財務表中該專案列。此操作無法復原。
              </p>
              <p className="mt-2 text-xs font-medium text-stone-500">專案ID：{selectedMaster.專案ID}</p>
              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  disabled={deletingMaster}
                  onClick={() => setShowDeleteMasterConfirm(false)}
                  className="rounded-xl border border-stone-300 bg-stone-50 px-4 py-2 text-sm font-semibold text-stone-600 transition hover:bg-stone-100 disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={deletingMaster}
                  onClick={async () => {
                    setDeletingMaster(true);
                    setSaveMasterError(null);
                    try {
                      const res = await fetch("/api/master", {
                        method: "DELETE",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ id: selectedMaster.id }),
                        cache: "no-store",
                      });
                      const data = (await safeResJson(res)) as { ok?: boolean; error?: string };
                      if (!res.ok || !data.ok) {
                        setSaveMasterError(data.error ?? "刪除失敗");
                        setDeletingMaster(false);
                        return;
                      }
                      setMasterList((prev) => prev.filter((r) => r.id !== selectedMaster.id));
                      setSelectedMaster(null);
                      setIsEditingMaster(false);
                      setShowDeleteMasterConfirm(false);
                      setDeletingMaster(false);
                      await refreshDashboardData(["tasks", "payout", "finance", "master"]);
                    } catch (err) {
                      setSaveMasterError(err instanceof Error ? err.message : "刪除失敗");
                      setDeletingMaster(false);
                    }
                  }}
                  className="rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white shadow transition hover:bg-red-500 disabled:opacity-50"
                >
                  {deletingMaster ? "刪除中…" : "確認刪除"}
                </button>
              </div>
            </div>
          </div>
        )}

        {pendingDeleteMasterTaskTemplate && (
          <div className="fixed inset-0 z-[72] flex items-center justify-center bg-stone-900/50 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-6 shadow-2xl ring-1 ring-stone-200/80" role="dialog" aria-modal="true">
              <h3 className="text-lg font-bold text-stone-900">確認刪除模板？</h3>
              <p className="mt-2 text-sm leading-relaxed text-stone-600">
                將永久刪除此排程模板，未來不會再自動建立該任務。此操作無法復原。
              </p>
              <p className="mt-2 text-xs font-medium text-stone-500">
                模板：{pendingDeleteMasterTaskTemplate.任務名稱}（每月 {pendingDeleteMasterTaskTemplate.每月幾號} 號）
              </p>
              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  disabled={deletingMasterTaskTemplateId === pendingDeleteMasterTaskTemplate.id}
                  onClick={() => setPendingDeleteMasterTaskTemplate(null)}
                  className="rounded-xl border border-stone-300 bg-stone-50 px-4 py-2 text-sm font-semibold text-stone-600 transition hover:bg-stone-100 disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={deletingMasterTaskTemplateId === pendingDeleteMasterTaskTemplate.id}
                  onClick={() => void deleteMasterTaskTemplateRow(pendingDeleteMasterTaskTemplate.id)}
                  className="rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white shadow transition hover:bg-red-500 disabled:opacity-50"
                >
                  {deletingMasterTaskTemplateId === pendingDeleteMasterTaskTemplate.id ? "刪除中…" : "確認刪除"}
                </button>
              </div>
            </div>
          </div>
        )}
        </>
      )}

      {/* 任務 編輯抽屜 */}
      {showChangePassword && (
        <div className="fixed inset-0 z-[65] flex items-center justify-center bg-stone-900/45 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-stone-200/90 bg-white p-5 shadow-2xl ring-1 ring-stone-200/80 sm:p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-stone-900">修改登入密碼</h2>
              <button
                type="button"
                onClick={() => {
                  setShowChangePassword(false);
                  setChangePasswordError(null);
                  setChangePasswordMessage(null);
                  setChangePasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
                }}
                className="rounded-lg border border-stone-300 bg-stone-50 px-3 py-1.5 text-xs font-semibold text-stone-600 transition hover:bg-stone-100"
              >
                關閉
              </button>
            </div>
            <form className="space-y-3" onSubmit={handleChangeMyPassword}>
              <PasswordInputField
                label="目前密碼"
                value={changePasswordForm.currentPassword}
                onChange={(v) => setChangePasswordForm((f) => ({ ...f, currentPassword: v }))}
                autoComplete="current-password"
              />
              <PasswordInputField
                label="新密碼"
                value={changePasswordForm.newPassword}
                onChange={(v) => setChangePasswordForm((f) => ({ ...f, newPassword: v }))}
                autoComplete="new-password"
              />
              <PasswordInputField
                label="確認新密碼"
                value={changePasswordForm.confirmPassword}
                onChange={(v) => setChangePasswordForm((f) => ({ ...f, confirmPassword: v }))}
                autoComplete="new-password"
              />
              {changePasswordError && <p className="rounded-lg bg-amber-100/90 px-3 py-2 text-sm text-amber-900">{changePasswordError}</p>}
              {changePasswordMessage && <p className="rounded-lg bg-emerald-100/90 px-3 py-2 text-sm text-emerald-800">{changePasswordMessage}</p>}
              <button
                type="submit"
                disabled={changingPassword}
                className="w-full rounded-xl bg-amber-500 py-2.5 text-sm font-bold text-stone-900 shadow-md shadow-amber-200/40 transition hover:bg-amber-400 disabled:opacity-50"
              >
                {changingPassword ? "更新中..." : "更新密碼"}
              </button>
            </form>
          </div>
        </div>
      )}

      {selectedTask && (
        <div className="fixed inset-0 z-[60] flex items-start justify-end bg-stone-900/30 backdrop-blur-sm">
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
                      任務類型: editTaskForm.任務類型.trim() || null,
                      負責人: editTaskForm.任務負責人.trim() || null,
                      備註: editTaskForm.備註.trim() || null,
                      到期日: editTaskForm.到期日.trim() || null,
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
                    任務類型: data.task.任務類型 ?? "",
                    任務負責人: data.task.任務負責人 ?? "",
                    到期日: data.task.到期日?.trim() ? data.task.到期日.trim().slice(0, 10) : "",
                    任務完成: Boolean(data.task.任務完成),
                    備註: data.task.備註 ?? "",
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
                <p className="text-xs text-stone-500">
                  建立者：<span className="font-medium text-stone-700">{selectedTask.建立者 ?? "—"}</span>
                </p>
                <p className="text-xs text-stone-500">
                  開始時間（系統）：<span className="font-medium text-stone-700">{formatTaskDisplayTime(selectedTask.開始時間)}</span>
                </p>
                <p className="text-xs text-stone-500">
                  完成時間（系統）：<span className="font-medium text-stone-700">{formatTaskDisplayTime(selectedTask.完成時間)}</span>
                </p>
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
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-stone-500">任務類型</label>
                  <select
                    value={editTaskForm.任務類型}
                    onChange={(e) => setEditTaskForm((f) => ({ ...f, 任務類型: e.target.value }))}
                    className="w-full rounded-xl border border-stone-300 bg-stone-50 px-3 py-2.5 text-sm font-medium text-stone-900 focus:border-amber-400/70 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                  >
                    <option value="">—</option>
                    {taskTypeOptions.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                    {editTaskForm.任務類型 && !taskTypeOptions.includes(editTaskForm.任務類型) ? (
                      <option value={editTaskForm.任務類型}>{editTaskForm.任務類型}</option>
                    ) : null}
                  </select>
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
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-stone-500">到期日</label>
                  <input
                    type="date"
                    value={editTaskForm.到期日}
                    onChange={(e) => setEditTaskForm((f) => ({ ...f, 到期日: e.target.value }))}
                    className="w-full rounded-xl border border-stone-300 bg-stone-50 px-3 py-2.5 text-sm font-medium text-stone-900 focus:border-amber-400/70 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                  />
                  <p className="mt-1 text-[11px] text-stone-500">系統每日寄送「即將到期／逾期」通知給負責人（需設定 RESEND 與 CRON_SECRET）。</p>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-stone-500">備註</label>
                  <textarea
                    value={editTaskForm.備註}
                    onChange={(e) => setEditTaskForm((f) => ({ ...f, 備註: e.target.value }))}
                    rows={4}
                    className="w-full rounded-xl border border-stone-300 bg-stone-50 px-3 py-2.5 text-sm font-medium text-stone-900 placeholder:text-stone-400 focus:border-amber-400/70 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                    placeholder="選填"
                  />
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

interface PasswordInputFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  autoComplete?: string;
}

function PasswordInputField({ label, value, onChange, className = "", autoComplete }: PasswordInputFieldProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div className={className}>
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</label>
      <div className="relative">
        <input
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          className="w-full rounded-xl border border-stone-300 bg-stone-50 py-2.5 pl-3 pr-[4.25rem] text-sm font-medium text-stone-900 placeholder:text-stone-500 focus:border-amber-400/70 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "隱藏密碼" : "顯示密碼"}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs font-semibold text-stone-600 transition hover:bg-stone-200/80 hover:text-stone-900"
        >
          {visible ? "隱藏" : "顯示"}
        </button>
      </div>
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
        onBlur={(e) => {
          const normalized = normalizeDecimalString(e.target.value, 2);
          if (normalized != null && normalized !== e.target.value) onChange(normalized);
        }}
      />
    </div>
  );
}

interface SearchableSelectFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  className?: string;
  /** 頂部搜尋框 placeholder */
  searchPlaceholder?: string;
  /** 選項為空時的說明（例如請先至合作夥伴新增） */
  emptyHint?: string;
}

/** 可搜尋下拉：頂部搜尋列 + 選項列表（內嵌展開，避免置於 Modal 內被 overflow 裁切） */
function SearchableSelectField({
  label,
  value,
  onChange,
  options,
  className = "",
  searchPlaceholder = "搜尋…",
  emptyHint,
}: SearchableSelectFieldProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (!open) setQ("");
  }, [open]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const base = [...new Set(options)].filter(Boolean);
    if (!qq) return base;
    return base.filter((o) => o.toLowerCase().includes(qq));
  }, [options, q]);

  return (
    <div className={`relative z-20 ${className}`} ref={rootRef}>
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</label>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-stone-300 bg-stone-50 px-3 py-2.5 text-left text-sm font-medium transition hover:border-amber-300/80 focus:border-amber-400/70 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
      >
        <span className={`min-w-0 truncate ${value ? "text-stone-900" : "text-stone-400"}`}>{value || "請選擇"}</span>
        <span className="shrink-0 text-stone-400" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div className="relative z-30 mt-1.5 rounded-xl border border-stone-200 bg-white p-2 shadow-lg ring-1 ring-stone-200/80">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={searchPlaceholder}
            className="mb-2 w-full rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1.5 text-xs text-stone-800 placeholder:text-stone-400 focus:border-amber-400/70 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
            autoComplete="off"
            onMouseDown={(e) => e.stopPropagation()}
          />
          <ul className="max-h-52 overflow-y-auto rounded-lg">
            <li>
              <button
                type="button"
                className="w-full rounded-lg px-2 py-2 text-left text-xs text-stone-500 transition hover:bg-amber-50"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
              >
                （清空）
              </button>
            </li>
            {filtered.map((name) => (
              <li key={name}>
                <button
                  type="button"
                  className={`w-full rounded-lg px-2 py-2 text-left text-xs transition hover:bg-amber-50 ${
                    value === name ? "bg-amber-50/80 font-semibold text-amber-900" : "text-stone-800"
                  }`}
                  onClick={() => {
                    onChange(name);
                    setOpen(false);
                  }}
                >
                  {name}
                </button>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="px-2 py-3 text-center text-xs leading-relaxed text-stone-400">
                {options.length === 0 ? emptyHint ?? "無可選項目" : "無符合搜尋的項目"}
              </li>
            )}
          </ul>
        </div>
      )}
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
  const inputRef = useRef<HTMLInputElement>(null);
  const openPicker = () => {
    const el = inputRef.current;
    if (!el) return;
    try {
      if (typeof el.showPicker === "function") {
        void el.showPicker();
        return;
      }
    } catch {
      /* 非使用者手勢等情境可能拋錯 */
    }
    el.focus();
    try {
      el.click();
    } catch {
      /* ignore */
    }
  };

  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</label>
      {/* 整欄可點：原生 date 常只有右側圖示能開日曆；input 設 pointer-events-none，點擊由外層呼叫 showPicker */}
      <div
        className="flex w-full cursor-pointer items-center rounded-xl border border-stone-300 bg-stone-50 px-3 py-2.5 text-sm font-medium text-stone-900 transition [color-scheme:light] focus-within:border-amber-400/70 focus-within:ring-2 focus-within:ring-amber-500/20"
        onClick={openPicker}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openPicker();
          }
        }}
        role="presentation"
      >
        <input
          ref={inputRef}
          type="date"
          tabIndex={0}
          className="pointer-events-none min-w-0 flex-1 border-0 bg-transparent p-0 text-sm font-medium text-stone-900 outline-none [color-scheme:light]"
          value={normalizeDateForInput(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
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

