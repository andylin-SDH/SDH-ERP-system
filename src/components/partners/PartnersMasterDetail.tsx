"use client";

import type { ReactNode } from "react";
import { SocialLinkIcons } from "@/components/SocialLinkIcons";
import { PartnerAvatar } from "@/components/partners/PartnerAvatar";
import type { PartnerRow } from "@/modules/partners";

export const PARTNERS_LIST_PAGE_SIZE_OPTIONS = [50, 100, 200] as const;
export type PartnersListPageSize = (typeof PARTNERS_LIST_PAGE_SIZE_OPTIONS)[number];
export type PartnersGradeFilter = "all" | "S" | "A" | "B" | "ungraded";

export type PartnerFilterTab = { key: string; label: string; count: number };

const PARTNER_DETAIL_SECTIONS: { title: string; keys: string[] }[] = [
  { title: "識別與分類", keys: ["PartnerID", "合作夥伴名稱", "類別一", "類別二", "類別三"] },
  { title: "聯絡與管道", keys: ["社群網站", "Email", "資料夾", "粉絲數", "頻道｜節目名稱"] },
  { title: "分潤與合約", keys: ["自來件分潤", "SDH開發分件分潤", "經銷約開始日", "經銷約結束日"] },
  { title: "人員", keys: ["KOL開發者", "主管"] },
  { title: "夥伴類型與其他", keys: ["分級", "是否有經營 私域群", "廣告經銷夥伴", "節目製作夥伴", "課程製作夥伴"] },
];

function formatPartnerDateDisplay(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim();
  if (!s) return "—";
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}/${m[2]}/${m[3]}`;
  return s;
}

export function partnerGradeKey(row: PartnerRow): PartnersGradeFilter {
  const g = String(row.分級 ?? "").trim().toUpperCase();
  if (g === "S" || g === "A" || g === "B") return g;
  return "ungraded";
}

export function PartnerGradePill({ grade }: { grade: string | null | undefined }) {
  const g = String(grade ?? "").trim().toUpperCase();
  if (!g) {
    return (
      <span className="inline-flex rounded-md bg-stone-100 px-1.5 py-0.5 text-[10px] font-bold text-stone-500">
        未分級
      </span>
    );
  }
  const cls =
    g === "S"
      ? "bg-amber-100 text-amber-900 ring-amber-200/80"
      : g === "A"
        ? "bg-emerald-100 text-emerald-900 ring-emerald-200/80"
        : g === "B"
          ? "bg-sky-100 text-sky-900 ring-sky-200/80"
          : "bg-stone-100 text-stone-700 ring-stone-200/80";
  return (
    <span className={`inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-bold ring-1 ring-inset ${cls}`}>
      {g}
    </span>
  );
}

function PartnerFolderLink({ url }: { url: string | null | undefined }) {
  const raw = String(url ?? "").trim();
  if (!raw) return <span className="text-stone-400">—</span>;
  const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-2.5 py-1 text-xs font-semibold text-stone-700 transition hover:border-amber-400/60 hover:bg-amber-50 hover:text-amber-900"
      title={raw}
    >
      <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
        />
      </svg>
      開啟資料夾
    </a>
  );
}

function PartnerDetailField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">{label}</dt>
      <dd className="mt-0.5 text-sm leading-relaxed text-stone-800">{children}</dd>
    </div>
  );
}

function PartnerDetailPanel({
  partner,
  columnLabels,
  onEdit,
  onPartnerUpdated,
}: {
  partner: PartnerRow;
  columnLabels: Record<string, string | undefined>;
  onEdit: () => void;
  onPartnerUpdated?: (partner: PartnerRow) => void;
}) {
  const name = String(partner.合作夥伴名稱 ?? "—").trim() || "—";
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-stone-200/90 bg-white px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-4">
            <PartnerAvatar
              partner={partner}
              size="lg"
              editable
              onUpdated={onPartnerUpdated}
            />
            <div className="min-w-0">
              <h3 className="truncate text-lg font-bold text-stone-900">{name}</h3>
              <p className="mt-0.5 text-xs text-stone-500">
                {partner.PartnerID ?? "—"}
                {partner.粉絲數 ? (
                  <>
                    {" "}
                    · 粉絲 <span className="font-semibold tabular-nums text-stone-700">{partner.粉絲數}</span>
                  </>
                ) : null}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <PartnerGradePill grade={partner.分級} />
                {partner.類別一 ? (
                  <span className="rounded-md bg-stone-100 px-2 py-0.5 text-[10px] font-medium text-stone-600">
                    {partner.類別一}
                  </span>
                ) : null}
                {partner.類別二 ? (
                  <span className="rounded-md bg-stone-50 px-2 py-0.5 text-[10px] text-stone-500 ring-1 ring-stone-200/80">
                    {partner.類別二}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <PartnerFolderLink url={partner.資料夾} />
            <button
              type="button"
              onClick={onEdit}
              className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-slate-900 shadow-sm transition hover:bg-amber-400"
            >
              編輯
            </button>
          </div>
        </div>
        {partner.社群網站 ? (
          <div className="mt-3 border-t border-stone-100 pt-3">
            <SocialLinkIcons value={partner.社群網站} />
          </div>
        ) : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {PARTNER_DETAIL_SECTIONS.map((section, sectionIdx) => (
          <div
            key={section.title}
            className={sectionIdx > 0 ? "mt-6 border-t border-dotted border-stone-200 pt-6" : undefined}
          >
            <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-stone-500">{section.title}</p>
            <dl className="grid gap-x-6 gap-y-3.5 sm:grid-cols-2">
              {section.keys.map((key) => {
                const label = columnLabels[key] ?? key;
                const val = (partner as unknown as Record<string, unknown>)[key];
                const isBool =
                  key === "是否有經營 私域群" ||
                  key === "廣告經銷夥伴" ||
                  key === "節目製作夥伴" ||
                  key === "課程製作夥伴";
                if (key === "社群網站") {
                  return (
                    <div key={key} className="sm:col-span-2">
                      <PartnerDetailField label={label}>
                        <SocialLinkIcons value={val as string} />
                      </PartnerDetailField>
                    </div>
                  );
                }
                if (key === "資料夾") {
                  return (
                    <div key={key} className="sm:col-span-2">
                      <PartnerDetailField label={label}>
                        <PartnerFolderLink url={val as string} />
                      </PartnerDetailField>
                    </div>
                  );
                }
                if (key === "分級") {
                  return (
                    <PartnerDetailField key={key} label={label}>
                      <PartnerGradePill grade={val as string} />
                    </PartnerDetailField>
                  );
                }
                let text: ReactNode;
                if (isBool) {
                  text = Boolean(val) ? "是" : "否";
                } else if (key === "經銷約開始日" || key === "經銷約結束日") {
                  text = formatPartnerDateDisplay(val as string);
                } else {
                  const s = String(val ?? "").trim();
                  text = s === "" ? "—" : s;
                }
                return (
                  <PartnerDetailField key={key} label={label}>
                    {text}
                  </PartnerDetailField>
                );
              })}
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}

function FilterTabRow({
  label,
  tabs,
  activeKey,
  onChange,
  scrollable,
}: {
  label: string;
  tabs: PartnerFilterTab[];
  activeKey: string;
  onChange: (key: string) => void;
  scrollable?: boolean;
}) {
  if (tabs.length <= 1) return null;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-stone-400">{label}</span>
      <div
        className={`flex min-w-0 flex-1 gap-0.5 rounded-lg border border-stone-200/80 bg-white p-0.5 ${
          scrollable ? "overflow-x-auto" : "flex-wrap"
        }`}
      >
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition ${
              activeKey === tab.key
                ? "bg-stone-800 text-white"
                : "text-stone-500 hover:bg-stone-100 hover:text-stone-900"
            }`}
          >
            {tab.label}
            <span className="ml-1 text-[10px] opacity-75">{tab.count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export interface PartnersMasterDetailProps {
  listPartners: PartnerRow[];
  totalCount: number;
  selectedPartner: PartnerRow | null;
  onSelectPartner: (pt: PartnerRow) => void;
  onEditPartner: (pt: PartnerRow) => void;
  onPartnerUpdated?: (partner: PartnerRow) => void;
  gradeTabs: PartnerFilterTab[];
  gradeFilter: PartnersGradeFilter;
  onGradeFilterChange: (v: PartnersGradeFilter) => void;
  category1Tabs: PartnerFilterTab[];
  category1Filter: string;
  onCategory1FilterChange: (v: string) => void;
  category2Tabs: PartnerFilterTab[];
  category2Filter: string;
  onCategory2FilterChange: (v: string) => void;
  showCategory2: boolean;
  listPage: number;
  listPageCount: number;
  listPageSafe: number;
  listPageSize: PartnersListPageSize;
  onListPageChange: (page: number) => void;
  onListPageSizeChange: (size: PartnersListPageSize) => void;
  columnLabels: Record<string, string | undefined>;
  mobileDetailOpen: boolean;
  onMobileDetailOpenChange: (open: boolean) => void;
}

export function PartnersMasterDetail({
  listPartners,
  totalCount,
  selectedPartner,
  onSelectPartner,
  onEditPartner,
  onPartnerUpdated,
  gradeTabs,
  gradeFilter,
  onGradeFilterChange,
  category1Tabs,
  category1Filter,
  onCategory1FilterChange,
  category2Tabs,
  category2Filter,
  onCategory2FilterChange,
  showCategory2,
  listPage,
  listPageCount,
  listPageSafe,
  listPageSize,
  onListPageChange,
  onListPageSizeChange,
  columnLabels,
  mobileDetailOpen,
  onMobileDetailOpenChange,
}: PartnersMasterDetailProps) {
  const empty = totalCount === 0;

  return (
    <>
      <div className="mb-3 space-y-2.5">
        <FilterTabRow
          label="分級"
          tabs={gradeTabs}
          activeKey={gradeFilter}
          onChange={(k) => onGradeFilterChange(k as PartnersGradeFilter)}
        />
        <FilterTabRow
          label="類別一"
          tabs={category1Tabs}
          activeKey={category1Filter}
          onChange={onCategory1FilterChange}
          scrollable
        />
        {showCategory2 && (
          <FilterTabRow
            label="類別二"
            tabs={category2Tabs}
            activeKey={category2Filter}
            onChange={onCategory2FilterChange}
            scrollable
          />
        )}
      </div>

      <div className="flex min-h-[58vh] flex-col overflow-hidden rounded-xl border border-stone-200/90 bg-white lg:flex-row">
        <div className="flex min-h-[280px] flex-col border-stone-200/90 lg:w-[min(380px,36%)] lg:border-r">
          <div className="flex-1 overflow-y-auto">
            {empty ? (
              <p className="px-4 py-12 text-center text-sm text-stone-500">沒有符合條件的 KOL</p>
            ) : listPartners.length === 0 ? (
              <p className="px-4 py-12 text-center text-sm text-stone-500">此頁沒有資料，請換頁或調整篩選</p>
            ) : (
              <ul className="divide-y divide-stone-100">
                {listPartners.map((pt) => {
                  const pid = pt.PartnerID ?? "";
                  const active = selectedPartner?.PartnerID === pid;
                  const name = String(pt.合作夥伴名稱 ?? "—").trim() || "—";
                  return (
                    <li key={pid || name}>
                      <button
                        type="button"
                        onClick={() => {
                          onSelectPartner(pt);
                          onMobileDetailOpenChange(true);
                        }}
                        className={`flex w-full items-start gap-3 px-4 py-3 text-left transition ${
                          active ? "bg-stone-900/[0.04] ring-1 ring-inset ring-amber-400/40" : "hover:bg-stone-50"
                        }`}
                      >
                        <PartnerAvatar partner={pt} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-stone-900">{name}</p>
                          <p className="mt-0.5 truncate text-[11px] text-stone-500">
                            {pt.粉絲數 ? `${pt.粉絲數} 粉絲` : "—"}
                            {pt["頻道｜節目名稱"] ? ` · ${String(pt["頻道｜節目名稱"]).trim()}` : ""}
                          </p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <PartnerGradePill grade={pt.分級} />
                            {pt.類別一 ? (
                              <span className="max-w-[8rem] truncate rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-600">
                                {pt.類別一}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <SocialLinkIcons value={pt.社群網站} className="shrink-0 opacity-80" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {!empty && (
            <div className="shrink-0 border-t border-stone-200/90 bg-stone-50/80 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] text-stone-600">
                  共 <strong className="tabular-nums">{totalCount}</strong> 筆
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1 text-[11px] text-stone-600">
                    <span>每頁</span>
                    <select
                      value={listPageSize}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (PARTNERS_LIST_PAGE_SIZE_OPTIONS.includes(n as PartnersListPageSize)) {
                          onListPageSizeChange(n as PartnersListPageSize);
                        }
                      }}
                      className="rounded border border-stone-300 bg-white px-1.5 py-0.5 text-[11px] font-semibold"
                    >
                      {PARTNERS_LIST_PAGE_SIZE_OPTIONS.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                  {listPageCount > 1 && (
                    <>
                      <button
                        type="button"
                        disabled={listPageSafe <= 1}
                        onClick={() => onListPageChange(Math.max(1, listPage - 1))}
                        className="rounded border border-stone-300 bg-white px-2 py-0.5 text-[11px] font-semibold disabled:opacity-40"
                      >
                        ◀
                      </button>
                      <span className="text-[11px] tabular-nums text-stone-600">
                        {listPageSafe}/{listPageCount}
                      </span>
                      <button
                        type="button"
                        disabled={listPageSafe >= listPageCount}
                        onClick={() => onListPageChange(Math.min(listPageCount, listPage + 1))}
                        className="rounded border border-stone-300 bg-white px-2 py-0.5 text-[11px] font-semibold disabled:opacity-40"
                      >
                        ▶
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="hidden min-h-[320px] flex-1 flex-col bg-white lg:flex">
          {selectedPartner ? (
            <PartnerDetailPanel
              partner={selectedPartner}
              columnLabels={columnLabels}
              onEdit={() => onEditPartner(selectedPartner)}
              onPartnerUpdated={onPartnerUpdated}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center p-8 text-sm text-stone-500">
              {empty ? "尚無合作夥伴資料" : "請從左側選擇 KOL 查看詳情"}
            </div>
          )}
        </div>
      </div>

      {mobileDetailOpen && selectedPartner && (
        <div className="fixed inset-0 z-[55] flex flex-col bg-white lg:hidden">
          <div className="flex shrink-0 items-center gap-2 border-b border-stone-200 px-3 py-2">
            <button
              type="button"
              onClick={() => onMobileDetailOpenChange(false)}
              className="rounded-lg px-3 py-1.5 text-sm font-semibold text-stone-600 hover:bg-stone-100"
            >
              ← 返回列表
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <PartnerDetailPanel
              partner={selectedPartner}
              columnLabels={columnLabels}
              onEdit={() => onEditPartner(selectedPartner)}
              onPartnerUpdated={onPartnerUpdated}
            />
          </div>
        </div>
      )}
    </>
  );
}
