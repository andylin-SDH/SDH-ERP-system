"use client";

import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { Fragment, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseKolAmount } from "@/lib/kol/format";
import { buildLaborClaimSplit, KOL_LABOR_SLIP_PREFERRED } from "@/lib/kol/claim-split";
import { isKolProjectOnHold } from "@/lib/kol/project-lifecycle";
import { SessionExpiryMonitor } from "@/components/SessionExpiryMonitor";
import { SignaturePad } from "@/components/SignaturePad";
import { useKolTheme } from "@/components/KolThemeShell";
import type { KolPortalProject } from "@/lib/kol/types";
import { kolHasRequestCredential, type KolRequestMode } from "@/lib/kol/finance-status";
import type { KolLaborProfile } from "@/lib/kol/partner-labor-profile";

async function safeResJson(r: Response): Promise<Record<string, unknown>> {
  const text = await r.text();
  if (!text.trim()) return {};
  try {
    return (JSON.parse(text) as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

function settlementBadgeClass(status: string): string {
  if (status === "暫緩") return "bg-violet-100 text-violet-950 ring-1 ring-violet-300/60";
  if (status === "執行中" || status === "未入帳") return "bg-stone-200 text-stone-800";
  if (status === "可請款") return "bg-sky-100 text-sky-950 ring-1 ring-sky-300/60";
  if (status === "待匯款") return "bg-amber-100 text-amber-950 ring-1 ring-amber-300/60";
  if (status === "已匯款") return "bg-emerald-100 text-emerald-900 ring-1 ring-emerald-300/50";
  return "bg-stone-100 text-stone-600";
}

/** 列表顯示用：暫緩優先；未入帳對外顯示為「執行中」 */
function kolListStatusLabel(p: KolPortalProject): string {
  if (isKolProjectOnHold(p.專案狀態)) return "暫緩";
  if (p.結帳狀態 === "未入帳") return "執行中";
  return p.結帳狀態;
}

type SettlementTab = "執行中" | "可請款" | "待匯款" | "已匯款" | "暫緩";

const SETTLEMENT_TABS: { key: SettlementTab; label: string; activeClass: string }[] = [
  { key: "執行中", label: "執行中", activeClass: "bg-stone-500 text-white shadow-sm" },
  { key: "可請款", label: "可請款", activeClass: "bg-sky-500 text-white shadow-sm" },
  { key: "待匯款", label: "待匯款", activeClass: "bg-amber-500 text-slate-900 shadow-sm" },
  { key: "已匯款", label: "已匯款", activeClass: "bg-emerald-600 text-white shadow-sm" },
  { key: "暫緩", label: "暫緩", activeClass: "bg-violet-600 text-white shadow-sm" },
];

function projectHasCredential(p: KolPortalProject): boolean {
  return kolHasRequestCredential({
    請款方式: p.請款方式,
    KOL發票號碼: p.KOL發票號碼,
    勞務期間起: p.勞務期間起,
    勞務期間迄: p.勞務期間迄,
    勞務內容: p.勞務內容,
    給付總額: p.給付總額,
    身分證字號: p.身分證字號,
    聯絡電話: p.聯絡電話,
    戶籍地址: p.戶籍地址,
    勞報簽署時間: p.勞報簽署時間,
    勞報簽名: p.勞報簽名,
  });
}

/** 列表橫向顯示：SDH 對外請款發票摘要 */
function formatSdhOutboundCell(p: KolPortalProject): { primary: string; secondary: string } {
  if (!p.客戶端發票.length) return { primary: "—", secondary: "" };
  const first = p.客戶端發票[0]!;
  const more = p.客戶端發票.length > 1 ? ` 等 ${p.客戶端發票.length} 張` : "";
  return {
    primary: `${first.發票號碼}${more}`,
    secondary: [first.發票日期, first.發票金額含稅 ? `含稅 ${first.發票金額含稅}` : ""].filter(Boolean).join(" · "),
  };
}

function formatSummaryAmount(n: number): string {
  if (!(n > 0)) return "—";
  return n.toLocaleString("zh-TW");
}

/** KOL 入口頂部三指標：同構卡片、數字著色，點擊切換分頁 */
function KolFinanceSummaryStrip({
  unclaimedTotal,
  remittedTotal,
  pendingCredentialCount,
  onOpenClaimable,
  onOpenRemitted,
  isDark,
}: {
  unclaimedTotal: number;
  remittedTotal: number;
  pendingCredentialCount: number;
  onOpenClaimable: () => void;
  onOpenRemitted: () => void;
  isDark: boolean;
}) {
  const cards = [
    {
      key: "remitted",
      label: "已匯款",
      hint: "匯款金額合計",
      value: formatSummaryAmount(remittedTotal),
      onClick: onOpenRemitted,
      accent: isDark ? "bg-teal-400" : "bg-teal-600",
      valueClass: remittedTotal > 0 ? (isDark ? "text-teal-300" : "text-teal-800") : isDark ? "text-stone-600" : "text-stone-400",
      delay: "0ms",
    },
    {
      key: "unclaimed",
      label: "未請款",
      hint: "可請款 · 未稅合計",
      value: formatSummaryAmount(unclaimedTotal),
      onClick: onOpenClaimable,
      accent: isDark ? "bg-rose-400" : "bg-rose-500",
      valueClass: unclaimedTotal > 0 ? (isDark ? "text-rose-300" : "text-rose-700") : isDark ? "text-stone-600" : "text-stone-400",
      delay: "70ms",
    },
    {
      key: "pending",
      label: "待填憑證",
      hint: "可請款 · 待填筆數",
      value: String(pendingCredentialCount),
      onClick: onOpenClaimable,
      accent: pendingCredentialCount > 0 ? (isDark ? "bg-amber-400" : "bg-amber-500") : isDark ? "bg-stone-600" : "bg-stone-300",
      valueClass:
        pendingCredentialCount > 0
          ? isDark
            ? "text-amber-100"
            : "text-stone-900"
          : isDark
            ? "text-stone-600"
            : "text-stone-400",
      delay: "140ms",
    },
  ] as const;

  return (
    <section aria-label="請款摘要" className="mb-7">
      <style>{`
        @keyframes kol-summary-in {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .kol-summary-card {
          animation: kol-summary-in 0.45s cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        @media (prefers-reduced-motion: reduce) {
          .kol-summary-card { animation: none; }
        }
      `}</style>
      <div className="grid gap-3 sm:grid-cols-3">
        {cards.map((card) => (
          <button
            key={card.key}
            type="button"
            onClick={card.onClick}
            style={{ animationDelay: card.delay }}
            className={
              isDark
                ? "kol-summary-card group rounded-xl border border-white/10 bg-[#161616] px-4 py-4 text-left transition hover:border-white/20 hover:bg-[#1c1c1c] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0b0c]"
                : "kol-summary-card group rounded-xl border border-stone-200/90 bg-white px-4 py-4 text-left transition hover:border-stone-300 hover:bg-stone-50/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 focus-visible:ring-offset-2"
            }
          >
            <div className={`mb-3 h-0.5 w-8 rounded-full ${card.accent}`} aria-hidden />
            <p className={`text-xs font-medium tracking-wide ${isDark ? "text-stone-400" : "text-stone-500"}`}>
              {card.label}
            </p>
            <p
              className={`mt-1.5 text-[1.85rem] font-semibold leading-none tabular-nums tracking-tight sm:text-[2rem] ${card.valueClass}`}
            >
              {card.value}
            </p>
            <p
              className={`mt-2 text-[11px] transition ${
                isDark ? "text-stone-500 group-hover:text-stone-400" : "text-stone-400 group-hover:text-stone-600"
              }`}
            >
              {card.hint}
            </p>
          </button>
        ))}
      </div>
    </section>
  );
}

const PAYOUT_FLOW_STEPS = [
  {
    status: "執行中",
    action: "等客戶付款入帳；財務填寫客戶入帳日後，才會開放請款。",
    bar: "border-l-stone-400",
    num: "bg-stone-100 text-stone-700",
  },
  {
    status: "可請款",
    action: "在「可請款」分頁勾選專案（可多選），點「提領」一次填發票或勞報即可。",
    bar: "border-l-sky-400",
    num: "bg-sky-100 text-sky-800",
  },
  {
    status: "待匯款",
    action: "已送出，SDH 將於收到發票後隔月 5 號前匯款；若發票號碼填錯，可按「撤回請款」回到可請款重填。",
    bar: "border-l-amber-400",
    num: "bg-amber-100 text-amber-900",
  },
  {
    status: "已匯款",
    action: "已完成，可查看結帳日期與金額。",
    bar: "border-l-emerald-500",
    num: "bg-emerald-100 text-emerald-800",
  },
] as const;

function FlowArrowIcon({ dir }: { dir: "right" | "down" }) {
  if (dir === "down") {
    return (
      <svg width="18" height="18" viewBox="0 0 18 18" className="text-amber-500/80">
        <path
          d="M9 4v10M9 14l-4-4M9 14l4-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" className="text-amber-500/80">
      <path
        d="M4 9h10M14 9l-4-4M14 9l-4 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PayoutFlowCard({
  step,
  idx,
  isDark,
}: {
  step: (typeof PAYOUT_FLOW_STEPS)[number];
  idx: number;
  isDark: boolean;
}) {
  return (
    <li
      className={`flex min-w-0 gap-2 rounded-lg border-l-[3px] px-2.5 py-2 shadow-sm ${step.bar} ${
        isDark
          ? "border border-white/10 bg-[#161616]"
          : "border border-stone-200/70 bg-white/90"
      }`}
    >
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
          isDark ? "bg-white/10 text-stone-200" : step.num
        }`}
      >
        {idx + 1}
      </span>
      <div className="min-w-0">
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${settlementBadgeClass(step.status)}`}
        >
          {step.status}
        </span>
        <p className={`mt-1 text-xs leading-snug ${isDark ? "text-stone-400" : "text-stone-700"}`}>{step.action}</p>
      </div>
    </li>
  );
}

function KolPayoutFlowGuide({ isDark }: { isDark: boolean }) {
  return (
    <section
      className={`mb-6 rounded-xl px-4 py-3.5 shadow-sm sm:px-5 ${
        isDark
          ? "border border-white/10 bg-[#141414] ring-1 ring-amber-500/10"
          : "border border-amber-200/70 bg-amber-50/45 ring-1 ring-amber-100/40"
      }`}
    >
      <h2 className={`text-sm font-bold ${isDark ? "text-stone-100" : "text-stone-900"}`}>請款怎麼走？</h2>
      <p className={`mt-0.5 text-xs leading-relaxed ${isDark ? "text-stone-400" : "text-stone-600"}`}>
        看列表「結帳狀態」對照下方四步。可請款時：勾選多筆 → 點「提領」→ 一次填憑證。
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {PAYOUT_FLOW_STEPS.map((step, idx) => (
          <span key={`path-${step.status}`} className="inline-flex items-center gap-1">
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${settlementBadgeClass(step.status)}`}
            >
              {step.status}
            </span>
            {idx < PAYOUT_FLOW_STEPS.length - 1 ? (
              <span className="text-sm font-medium text-amber-500/80" aria-hidden>
                →
              </span>
            ) : null}
          </span>
        ))}
      </div>

      {/* 手機：直向 */}
      <ol className="mt-2.5 flex flex-col gap-0 sm:hidden">
        {PAYOUT_FLOW_STEPS.map((step, idx) => (
          <Fragment key={step.status}>
            {idx > 0 ? (
              <li className="list-none flex justify-center py-0.5" aria-hidden>
                <FlowArrowIcon dir="down" />
              </li>
            ) : null}
            <PayoutFlowCard step={step} idx={idx} isDark={isDark} />
          </Fragment>
        ))}
      </ol>

      {/* 平板 2×2：Z 型箭頭 1→2 ↓ 3→4 */}
      <ol className="mt-2.5 hidden gap-x-1 gap-y-1 sm:grid sm:grid-cols-[1fr_auto_1fr] lg:hidden">
        <PayoutFlowCard step={PAYOUT_FLOW_STEPS[0]} idx={0} isDark={isDark} />
        <li className="list-none flex items-center justify-center px-0.5" aria-hidden>
          <FlowArrowIcon dir="right" />
        </li>
        <PayoutFlowCard step={PAYOUT_FLOW_STEPS[1]} idx={1} isDark={isDark} />
        <li className="list-none" aria-hidden />
        <li className="list-none flex justify-center py-0.5" aria-hidden>
          <FlowArrowIcon dir="down" />
        </li>
        <li className="list-none" aria-hidden />
        <PayoutFlowCard step={PAYOUT_FLOW_STEPS[2]} idx={2} isDark={isDark} />
        <li className="list-none flex items-center justify-center px-0.5" aria-hidden>
          <FlowArrowIcon dir="right" />
        </li>
        <PayoutFlowCard step={PAYOUT_FLOW_STEPS[3]} idx={3} isDark={isDark} />
      </ol>

      {/* 大螢幕：橫向一列 */}
      <ol className="mt-2.5 hidden items-center gap-0 lg:flex">
        {PAYOUT_FLOW_STEPS.map((step, idx) => (
          <Fragment key={step.status}>
            {idx > 0 ? (
              <li className="list-none flex px-1" aria-hidden>
                <FlowArrowIcon dir="right" />
              </li>
            ) : null}
            <PayoutFlowCard step={step} idx={idx} isDark={isDark} />
          </Fragment>
        ))}
      </ol>
    </section>
  );
}

function KolHomeInner() {
  const { isDark } = useKolTheme();
  const searchParams = useSearchParams();
  const previewPartnerId = String(searchParams.get("previewPartner") ?? "").trim();
  const isPreview = Boolean(previewPartnerId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [partnerName, setPartnerName] = useState<string>("");
  const [partnerId, setPartnerId] = useState<string>("");
  const [laborProfile, setLaborProfile] = useState<KolLaborProfile>({
    身分證字號: "",
    聯絡電話: "",
    戶籍地址: "",
  });
  const [projects, setProjects] = useState<KolPortalProject[]>([]);
  const [settlementTab, setSettlementTab] = useState<SettlementTab>("執行中");
  const [sessionActive, setSessionActive] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [selectedClaimPids, setSelectedClaimPids] = useState<string[]>([]);
  const [claimCheckoutOpen, setClaimCheckoutOpen] = useState(false);
  const [claimForm, setClaimForm] = useState({
    請款方式: "發票" as KolRequestMode,
    KOL發票號碼: "",
    KOL發票日期: "",
    KOL發票金額: "",
    KOL發票備註: "",
    勞務期間起: "",
    勞務期間迄: "",
    勞務內容: "",
    身分證字號: "",
    聯絡電話: "",
    戶籍地址: "",
    勞報簽名: "",
    勞報簽署: false,
  });
  const [claimSaving, setClaimSaving] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [revokingPid, setRevokingPid] = useState<string | null>(null);
  const loadSeqRef = useRef(0);
  const settlementTabInitialized = useRef(false);
  const loadAbortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    setLoading(true);
    setError(null);
    const timeoutId = window.setTimeout(() => controller.abort(), 20000);
    try {
      const url = isPreview
        ? `/api/kol/preview?partnerId=${encodeURIComponent(previewPartnerId)}`
        : "/api/kol/overview";
      const res = await fetch(url, {
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
      });
      const data = (await safeResJson(res)) as {
        ok?: boolean;
        error?: string;
        partnerName?: string;
        partnerId?: string;
        laborProfile?: KolLaborProfile;
        projects?: KolPortalProject[];
      };
      if (seq !== loadSeqRef.current) return;
      if (res.status === 401) {
        setLoading(false);
        window.location.href = "/";
        return;
      }
      if (res.status === 403) {
        setError(
          data.error ??
            (isPreview
              ? "僅董事長、管理者或會計可預覽 KOL 老師視角。"
              : "此帳號不是 KOL 專用入口，請聯絡管理員。")
        );
        return;
      }
      if (!res.ok || !data.ok) {
        setError(data.error ?? "無法載入資料，請稍後按「重新整理」再試。");
        return;
      }
      setPartnerName(data.partnerName ?? "");
      setPartnerId(data.partnerId ?? "");
      const profile = data.laborProfile ?? { 身分證字號: "", 聯絡電話: "", 戶籍地址: "" };
      setLaborProfile(profile);
      const list = (Array.isArray(data.projects) ? data.projects : []).map((p) =>
        isPreview ? { ...p, canEditKolInvoice: false } : p
      );
      setProjects(list);
      setSessionActive(!isPreview);
    } catch (e) {
      if (seq !== loadSeqRef.current) return;
      if (e instanceof DOMException && e.name === "AbortError") {
        setError("載入逾時或已取消，請按「重新整理」再試。");
      } else {
        setError(e instanceof Error ? e.message : "無法載入資料，請稍後再試。");
      }
    } finally {
      window.clearTimeout(timeoutId);
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, [isPreview, previewPartnerId]);

  const handleSessionEnd = useCallback(() => {
    setSessionActive(false);
    window.location.href = "/";
  }, []);

  useEffect(() => {
    void load();
    return () => {
      loadAbortRef.current?.abort();
    };
  }, [load]);

  const projectsBySettlement = useMemo(() => {
    const buckets: Record<SettlementTab, KolPortalProject[]> = {
      執行中: [],
      可請款: [],
      待匯款: [],
      已匯款: [],
      暫緩: [],
    };
    for (const p of projects) {
      if (isKolProjectOnHold(p.專案狀態)) {
        buckets.暫緩.push(p);
        continue;
      }
      if (p.結帳狀態 === "未入帳") {
        buckets.執行中.push(p);
        continue;
      }
      const key = (["可請款", "待匯款", "已匯款"] as const).includes(
        p.結帳狀態 as "可請款" | "待匯款" | "已匯款"
      )
        ? (p.結帳狀態 as "可請款" | "待匯款" | "已匯款")
        : "執行中";
      buckets[key].push(p);
    }
    return buckets;
  }, [projects]);

  const summary = useMemo(() => {
    const claimable = projectsBySettlement["可請款"];
    const remitted = projectsBySettlement["已匯款"];
    const missingKolInvoice = claimable.filter((p) => !projectHasCredential(p)).length;
    let unclaimedTotal = 0;
    for (const p of claimable) {
      unclaimedTotal += parseKolAmount(p.KOL費用未稅);
    }
    let remittedTotal = 0;
    for (const p of remitted) {
      remittedTotal += parseKolAmount(p.KOL匯款金額 || p.KOL費用未稅);
    }
    return {
      missingKolInvoice,
      unclaimedTotal,
      remittedTotal,
    };
  }, [projectsBySettlement]);

  const visibleProjects = projectsBySettlement[settlementTab];

  const claimableSelected = useMemo(() => {
    const set = new Set(selectedClaimPids);
    return projectsBySettlement["可請款"].filter((p) => set.has(p.專案ID) && p.canEditKolInvoice);
  }, [projectsBySettlement, selectedClaimPids]);

  const claimableSelectedTotal = useMemo(
    () => claimableSelected.reduce((a, p) => a + parseKolAmount(p.KOL費用未稅), 0),
    [claimableSelected]
  );

  const claimLaborSplit = useMemo(() => {
    if (claimForm.請款方式 !== "勞務報酬" || claimableSelected.length === 0) return null;
    try {
      return buildLaborClaimSplit(
        claimableSelected.map((p) => ({
          專案ID: p.專案ID,
          金額: parseKolAmount(p.KOL費用未稅),
          專案名稱: p.專案名稱,
        }))
      );
    } catch {
      return null;
    }
  }, [claimForm.請款方式, claimableSelected]);

  useEffect(() => {
    if (settlementTab !== "可請款") setSelectedClaimPids([]);
  }, [settlementTab]);

  useEffect(() => {
    if (projects.length === 0 || settlementTabInitialized.current) return;
    const preferred: SettlementTab[] = ["可請款", "待匯款", "執行中", "已匯款", "暫緩"];
    const firstWithItems = preferred.find((k) => projectsBySettlement[k].length > 0);
    if (firstWithItems) setSettlementTab(firstWithItems);
    settlementTabInitialized.current = true;
  }, [projects.length, projectsBySettlement]);

  function toggleClaimSelect(pid: string) {
    setSelectedClaimPids((prev) => (prev.includes(pid) ? prev.filter((x) => x !== pid) : [...prev, pid]));
  }

  function toggleClaimSelectAll() {
    const ids = projectsBySettlement["可請款"].filter((p) => p.canEditKolInvoice).map((p) => p.專案ID);
    setSelectedClaimPids((prev) => (prev.length === ids.length ? [] : ids));
  }

  function openClaimCheckout(seedPids?: string[]) {
    if (isPreview) {
      setSaveNotice("預覽模式為唯讀，無法提領。");
      return;
    }
    const seed = (seedPids ?? []).map((x) => String(x).trim()).filter(Boolean);
    if (seed.length > 0) {
      setSelectedClaimPids((prev) => [...new Set([...prev, ...seed])]);
    }
    const selected =
      seed.length > 0
        ? projectsBySettlement["可請款"].filter((p) => seed.includes(p.專案ID) && p.canEditKolInvoice)
        : claimableSelected;
    if (selected.length === 0) {
      setSaveNotice("請先勾選要提領的專案");
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    setClaimForm({
      請款方式: "發票",
      KOL發票號碼: "",
      KOL發票日期: today,
      KOL發票金額: String(selected.reduce((a, p) => a + parseKolAmount(p.KOL費用未稅), 0) || ""),
      KOL發票備註: "",
      勞務期間起: today,
      勞務期間迄: today,
      勞務內容: `批次請款（${selected.length} 筆專案）`,
      身分證字號: laborProfile.身分證字號 || "",
      聯絡電話: laborProfile.聯絡電話 || "",
      戶籍地址: laborProfile.戶籍地址 || "",
      勞報簽名: "",
      勞報簽署: false,
    });
    setClaimError(null);
    setClaimCheckoutOpen(true);
  }

  async function submitClaimBatch() {
    if (isPreview || claimableSelected.length === 0) return;
    setClaimSaving(true);
    setClaimError(null);
    try {
      const isLabor = claimForm.請款方式 === "勞務報酬";
      const res = await fetch("/api/kol/claim-batch", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isLabor
            ? {
                專案IDs: claimableSelected.map((p) => p.專案ID),
                請款方式: "勞務報酬",
                勞務期間起: claimForm.勞務期間起.trim() || null,
                勞務期間迄: claimForm.勞務期間迄.trim() || null,
                勞務內容: claimForm.勞務內容.trim() || null,
                身分證字號: claimForm.身分證字號.trim() || null,
                領款方式: "現金",
                聯絡電話: claimForm.聯絡電話.trim() || null,
                戶籍地址: claimForm.戶籍地址.trim() || null,
                KOL發票備註: claimForm.KOL發票備註.trim() || null,
                勞報簽署: claimForm.勞報簽署,
                勞報簽名: claimForm.勞報簽名.trim() || null,
              }
            : {
                專案IDs: claimableSelected.map((p) => p.專案ID),
                請款方式: "發票",
                KOL發票號碼: claimForm.KOL發票號碼.trim() || null,
                KOL發票日期: claimForm.KOL發票日期.trim() || null,
                KOL發票金額: claimForm.KOL發票金額.trim().replace(/,/g, "") || null,
                KOL發票備註: claimForm.KOL發票備註.trim() || null,
              }
        ),
      });
      const data = (await safeResJson(res)) as {
        ok?: boolean;
        error?: string;
        updated?: number;
        split?: { total?: number; slips?: Array<{ 序號: number; 給付總額: number }> } | null;
      };
      if (!res.ok || !data.ok) {
        setClaimError(data.error ?? "批次請款失敗");
        return;
      }
      const slipHint =
        data.split?.slips?.length
          ? `，拆成 ${data.split.slips.length} 張勞報（合計 NT$ ${(data.split.total ?? 0).toLocaleString("zh-TW")}）`
          : "";
      setClaimCheckoutOpen(false);
      setSelectedClaimPids([]);
      setSaveNotice(
        isLabor
          ? `已提領 ${data.updated ?? claimableSelected.length} 筆${slipHint}`
          : `已將發票號碼套用至 ${data.updated ?? claimableSelected.length} 筆專案`
      );
      setSettlementTab("待匯款");
      await load();
    } catch (e) {
      setClaimError(e instanceof Error ? e.message : "批次請款失敗");
    } finally {
      setClaimSaving(false);
    }
  }

  async function revokeClaimCredential(p: KolPortalProject) {
    if (isPreview || !p.canEditKolInvoice || p.結帳狀態 !== "待匯款") return;
    const batchHint = p.請款批次ID
      ? "\n（此筆為批次提領，同批尚未匯款的專案會一併撤回。）"
      : "";
    if (
      !window.confirm(
        `確定撤回「${p.專案名稱}」的請款憑證？\n清除後會回到可請款，可重新提領。${batchHint}`
      )
    ) {
      return;
    }
    setRevokingPid(p.專案ID);
    setSaveNotice(null);
    try {
      const res = await fetch("/api/kol/invoices", {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 專案ID: p.專案ID }),
      });
      const data = (await safeResJson(res)) as {
        ok?: boolean;
        error?: string;
        cleared?: number;
      };
      if (!res.ok || !data.ok) {
        setSaveNotice(data.error ?? "撤回失敗");
        return;
      }
      setSaveNotice(
        data.cleared && data.cleared > 1
          ? `已撤回 ${data.cleared} 筆請款，已回到可請款`
          : "已撤回請款，已回到可請款"
      );
      setSettlementTab("可請款");
      await load();
    } catch (e) {
      setSaveNotice(e instanceof Error ? e.message : "撤回失敗");
    } finally {
      setRevokingPid(null);
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/session", { method: "DELETE", credentials: "include" });
    window.location.href = "/";
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-8 sm:px-6">
      <SessionExpiryMonitor active={sessionActive && !loading && !error && !isPreview} onSessionEnd={handleSessionEnd} />
      {isPreview ? (
        <div
          className={`mb-4 rounded-xl px-4 py-3 text-sm ${
            isDark
              ? "border border-sky-400/30 bg-sky-500/10 text-sky-100"
              : "border border-sky-200 bg-sky-50 text-sky-950"
          }`}
        >
          <p className="font-semibold">
            預覽：{partnerName || "KOL"} 的老師入口（唯讀）
          </p>
          <p className={`mt-0.5 text-xs ${isDark ? "text-sky-200/80" : "text-sky-900/70"}`}>
            與老師看到的分頁與狀態相同；不可代填請款。請從財務返回後再操作匯款。
          </p>
        </div>
      ) : null}
      <header
        className={`mb-8 flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-center sm:justify-between ${
          isDark ? "border-white/10" : "border-amber-200/80"
        }`}
      >
        <div className="flex items-center gap-4">
          <Image
            src="/logo.png"
            alt="SDH"
            width={200}
            height={48}
            className={`h-10 w-auto object-contain ${isDark ? "brightness-0 invert opacity-90" : ""}`}
          />
          <div>
            <h1 className={`text-lg font-bold tracking-tight ${isDark ? "text-stone-50" : "text-stone-900"}`}>
              {isPreview ? `${partnerName || "KOL"}｜老師視角` : "我的專案"}
            </h1>
            <p className={`text-xs ${isDark ? "text-stone-500" : "text-stone-500"}`}>
              結帳狀態：執行中 → 可請款 → 待匯款 → 已匯款；專案狀態「暫緩」另列
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className={
              isDark
                ? "rounded-xl border border-amber-400/40 bg-amber-500/15 px-4 py-2 text-sm font-semibold text-amber-200 transition hover:bg-amber-500/25"
                : "rounded-xl border border-amber-300/80 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-950 shadow-sm hover:bg-amber-100"
            }
          >
            {loading ? "載入中…" : "重新整理"}
          </button>
          {isPreview ? (
            <a
              href="/dashboard?section=finance&financeSubTab=kolPortalView"
              className={
                isDark
                  ? "rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-stone-300 transition hover:bg-white/10"
                  : "rounded-xl border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-600 shadow-sm hover:bg-stone-50"
              }
            >
              返回財務
            </a>
          ) : (
            <button
              type="button"
              onClick={handleLogout}
              className={
                isDark
                  ? "rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-stone-300 transition hover:bg-white/10"
                  : "rounded-xl border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-600 shadow-sm hover:bg-stone-50"
              }
            >
              登出
            </button>
          )}
        </div>
      </header>

      {loading && (
        <div
          className={`rounded-xl px-4 py-8 text-center ${
            isDark ? "border border-white/10 bg-[#161616]" : "border border-stone-200 bg-white/80"
          }`}
        >
          <p className={isDark ? "text-stone-300" : "text-stone-600"}>載入中…</p>
          <p className={`mt-2 text-xs ${isDark ? "text-stone-500" : "text-stone-400"}`}>
            若超過 30 秒仍無回應，請按右上角「重新整理」
          </p>
        </div>
      )}
      {error && (
        <div
          className={`rounded-xl px-4 py-3 text-sm ${
            isDark
              ? "border border-amber-400/30 bg-amber-500/10 text-amber-100"
              : "border border-amber-200 bg-amber-50 text-amber-950"
          }`}
        >
          <p>{error}</p>
          {error.includes("KOL發票") || error.includes("migration") ? (
            <p className={`mt-2 text-xs ${isDark ? "text-amber-200/80" : "text-amber-900/80"}`}>
              管理員請至 Supabase SQL Editor 依序執行：053_kol_invoices.sql、055_kol_remittance.sql、056_kol_labor_remuneration.sql、057_kol_labor_receipt_fields.sql
            </p>
          ) : null}
        </div>
      )}
      {saveNotice && (
        <div
          className={`mb-4 rounded-xl px-4 py-3 text-sm ${
            isDark
              ? "border border-emerald-400/30 bg-emerald-500/10 text-emerald-100"
              : "border border-emerald-200 bg-emerald-50 text-emerald-900"
          }`}
        >
          {saveNotice}
        </div>
      )}

      {!loading && !error && (
        <>
          <KolPayoutFlowGuide isDark={isDark} />

          <p className={`mb-4 text-sm ${isDark ? "text-stone-400" : "text-stone-600"}`}>
            <span className={`font-semibold ${isDark ? "text-stone-100" : "text-stone-800"}`}>
              {partnerName || "—"}
            </span>
            {partnerId ? (
              <span className={`ml-2 ${isDark ? "text-stone-500" : "text-stone-500"}`}>（{partnerId}）</span>
            ) : null}
          </p>

          <KolFinanceSummaryStrip
            unclaimedTotal={summary.unclaimedTotal}
            remittedTotal={summary.remittedTotal}
            pendingCredentialCount={summary.missingKolInvoice}
            onOpenClaimable={() => setSettlementTab("可請款")}
            onOpenRemitted={() => setSettlementTab("已匯款")}
            isDark={isDark}
          />

          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div
              className={`inline-flex max-w-full flex-wrap rounded-lg p-0.5 text-sm ${
                isDark ? "border border-white/10 bg-white/5" : "border border-stone-200 bg-stone-100/80"
              }`}
            >
              {SETTLEMENT_TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setSettlementTab(tab.key)}
                  className={`rounded-md px-3 py-1.5 font-semibold transition ${
                    settlementTab === tab.key
                      ? tab.activeClass
                      : isDark
                        ? "text-stone-400 hover:text-stone-100"
                        : "text-stone-600 hover:text-stone-900"
                  }`}
                >
                  {tab.label}
                  <span className="ml-1.5 text-xs font-normal opacity-80">
                    ({projectsBySettlement[tab.key].length})
                  </span>
                </button>
              ))}
            </div>
            <p className={`text-xs ${isDark ? "text-stone-500" : "text-stone-500"}`}>
              <span
                className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-medium ${
                  isDark ? "bg-amber-500/15 text-amber-200" : "bg-amber-100/80 text-amber-900"
                }`}
              >
                {settlementTab === "可請款" && !isPreview
                  ? "勾選專案後點下方「提領」，一次填發票或勞報"
                  : "列表直接顯示專案與 SDH 對外請款資訊"}
              </span>
            </p>
          </div>

          {projects.length === 0 ? (
            <p
              className={`rounded-xl px-4 py-10 text-center ${
                isDark
                  ? "border border-white/10 bg-[#161616] text-stone-400"
                  : "border border-stone-200 bg-white/80 text-stone-500"
              }`}
            >
              目前沒有與您對應的專案。請確認大總表「KOL 名稱」與您的合作夥伴名稱一致。
            </p>
          ) : visibleProjects.length === 0 ? (
            <p
              className={`rounded-xl px-4 py-10 text-center ${
                isDark
                  ? "border border-white/10 bg-[#161616] text-stone-400"
                  : "border border-stone-200 bg-white/80 text-stone-500"
              }`}
            >
              目前沒有「{settlementTab}」的專案。
            </p>
          ) : (
            <div
              className={`overflow-x-auto rounded-xl shadow-sm ${
                isDark
                  ? "border border-white/10 bg-[#121212] ring-1 ring-white/5"
                  : "border border-stone-200/90 bg-white ring-1 ring-amber-100/50"
              }`}
            >
              <table className="min-w-full text-left text-sm">
                <thead
                  className={
                    isDark
                      ? "border-b border-white/10 bg-[#1a1a1a] text-stone-300"
                      : "border-b border-amber-200/60 bg-gradient-to-r from-amber-100/95 to-amber-50/90 text-amber-950"
                  }
                >
                  <tr>
                    {settlementTab === "可請款" && !isPreview ? (
                      <th className="w-10 px-2 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={
                            projectsBySettlement["可請款"].filter((p) => p.canEditKolInvoice).length > 0 &&
                            selectedClaimPids.length ===
                              projectsBySettlement["可請款"].filter((p) => p.canEditKolInvoice).length
                          }
                          onChange={toggleClaimSelectAll}
                          className="h-4 w-4 rounded border-stone-300 text-amber-600 focus:ring-amber-500"
                          aria-label="全選可請款專案"
                        />
                      </th>
                    ) : null}
                    <th className="whitespace-nowrap px-3 py-3 text-xs font-bold tracking-wide">專案ID</th>
                    <th className="min-w-[140px] px-3 py-3 text-xs font-bold tracking-wide">專案名稱</th>
                    <th className="whitespace-nowrap px-3 py-3 text-xs font-bold tracking-wide">結帳狀態</th>
                    <th className="whitespace-nowrap px-3 py-3 text-xs font-bold tracking-wide">KOL應領金額未稅</th>
                    <th className="whitespace-nowrap px-3 py-3 text-xs font-bold tracking-wide">專案總金額未稅</th>
                    <th className="min-w-[160px] px-3 py-3 text-xs font-bold tracking-wide">SDH對外請款</th>
                    <th className="whitespace-nowrap px-3 py-3 text-xs font-bold tracking-wide">請款憑證</th>
                    <th className="whitespace-nowrap px-3 py-3 text-xs font-bold tracking-wide">客戶入帳日</th>
                    <th className="whitespace-nowrap px-3 py-3 text-xs font-bold tracking-wide">結帳日期</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleProjects.map((p) => {
                    const listStatus = kolListStatusLabel(p);
                    const needsAction =
                      !isKolProjectOnHold(p.專案狀態) &&
                      p.結帳狀態 === "可請款" &&
                      !projectHasCredential(p);
                    const sdhOut = formatSdhOutboundCell(p);
                    return (
                      <tr
                        key={p.專案ID}
                        className={`border-b transition-colors last:border-b-0 ${
                          isDark
                            ? needsAction
                              ? "border-white/5 bg-[#141414] hover:bg-sky-500/10"
                              : "border-white/5 bg-[#121212] even:bg-[#161616] hover:bg-amber-500/5"
                            : needsAction
                              ? "border-stone-100 bg-white hover:bg-sky-50/50"
                              : "border-stone-100 bg-white even:bg-stone-50/40 hover:bg-amber-50/50"
                        }`}
                      >
                        {settlementTab === "可請款" && !isPreview ? (
                          <td className="px-2 py-3 text-center">
                            {p.canEditKolInvoice ? (
                              <input
                                type="checkbox"
                                checked={selectedClaimPids.includes(p.專案ID)}
                                onChange={() => toggleClaimSelect(p.專案ID)}
                                className="h-4 w-4 rounded border-stone-300 text-amber-600 focus:ring-amber-500"
                                aria-label={`選取 ${p.專案名稱}`}
                              />
                            ) : (
                              <span className="inline-block w-4" />
                            )}
                          </td>
                        ) : null}
                        <td
                          className={`whitespace-nowrap px-3 py-3.5 font-mono text-[11px] ${
                            isDark ? "text-stone-500" : "text-stone-600"
                          }`}
                        >
                          {p.專案ID}
                        </td>
                        <td className="max-w-[220px] px-3 py-3.5">
                          <p className={`font-semibold ${isDark ? "text-stone-100" : "text-stone-900"}`}>
                            {p.專案名稱}
                          </p>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3.5">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${settlementBadgeClass(listStatus)}`}
                          >
                            {listStatus}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3.5">
                          <span
                            className={`inline-flex min-w-[4.5rem] items-center justify-center rounded-lg px-2.5 py-1 text-base font-bold tabular-nums ring-1 ${
                              isDark
                                ? "bg-amber-500/15 text-amber-200 ring-amber-400/30"
                                : "bg-amber-100 text-amber-950 ring-amber-300/70"
                            }`}
                          >
                            {p.KOL費用未稅}
                          </span>
                        </td>
                        <td
                          className={`whitespace-nowrap px-3 py-3.5 tabular-nums ${
                            isDark ? "text-stone-400" : "text-stone-600"
                          }`}
                        >
                          {p.專案總金額未稅}
                        </td>
                        <td className="min-w-[160px] max-w-[220px] px-3 py-3.5">
                          <p
                            className={`truncate font-mono text-xs font-semibold ${
                              isDark ? "text-stone-200" : "text-stone-800"
                            }`}
                            title={sdhOut.primary}
                          >
                            {sdhOut.primary}
                          </p>
                          {sdhOut.secondary ? (
                            <p className={`mt-0.5 truncate text-[10px] ${isDark ? "text-stone-500" : "text-stone-500"}`}>
                              {sdhOut.secondary}
                            </p>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3.5 text-xs">
                          {p.請款憑證摘要 ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={isDark ? "text-stone-200" : "text-stone-800"}>
                                <span className={isDark ? "text-stone-500" : "text-stone-500"}>
                                  {p.請款方式 === "勞務報酬" ? "勞報" : "發票"}
                                </span>
                                <span className="ml-1 font-mono font-semibold">{p.請款憑證摘要}</span>
                              </span>
                              {settlementTab === "待匯款" && !isPreview && p.canEditKolInvoice ? (
                                <button
                                  type="button"
                                  disabled={revokingPid === p.專案ID}
                                  onClick={() => void revokeClaimCredential(p)}
                                  className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 transition disabled:opacity-60 ${
                                    isDark
                                      ? "bg-stone-800 text-rose-300 ring-rose-400/40 hover:bg-rose-500/15"
                                      : "bg-white text-rose-700 ring-rose-200 hover:bg-rose-50"
                                  }`}
                                >
                                  {revokingPid === p.專案ID ? "撤回中…" : "撤回請款"}
                                </button>
                              ) : null}
                            </div>
                          ) : needsAction ? (
                            <span
                              className={`inline-flex rounded-md px-2 py-0.5 font-semibold ring-1 ${
                                isDark
                                  ? "bg-rose-500/15 text-rose-300 ring-rose-400/30"
                                  : "bg-red-50 text-red-700 ring-red-200/80"
                              }`}
                            >
                              待提領
                            </span>
                          ) : (
                            <span className={isDark ? "text-stone-600" : "text-stone-400"}>—</span>
                          )}
                        </td>
                        <td
                          className={`whitespace-nowrap px-3 py-3.5 tabular-nums ${
                            isDark ? "text-stone-300" : "text-stone-700"
                          }`}
                        >
                          {p.廠商付款日期}
                        </td>
                        <td
                          className={`whitespace-nowrap px-3 py-3.5 tabular-nums ${
                            isDark ? "text-stone-300" : "text-stone-700"
                          }`}
                        >
                          {p.KOL匯款日期 ||
                            (p.結帳狀態 === "待匯款" ? (
                              <span className={isDark ? "text-amber-300" : "text-amber-700"}>待匯款</span>
                            ) : (
                              "—"
                            ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

            </div>
          )}
        </>
      )}

      {settlementTab === "可請款" && !isPreview && claimableSelected.length > 0 ? (
        <div className="sticky bottom-4 z-40 mt-4">
          <div
            className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3 shadow-xl ${
              isDark
                ? "border border-amber-400/40 bg-[#1a1a1a]/95 backdrop-blur"
                : "border border-amber-200 bg-white/95 ring-1 ring-amber-100 backdrop-blur"
            }`}
          >
            <div className="text-sm">
              <span className="font-bold text-amber-700">已選 {claimableSelected.length} 筆</span>
              <span className={`ml-2 tabular-nums ${isDark ? "text-stone-300" : "text-stone-600"}`}>
                未稅合計 NT$ {claimableSelectedTotal.toLocaleString("zh-TW")}
              </span>
            </div>
            <button
              type="button"
              onClick={() => openClaimCheckout()}
              className="rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-bold text-slate-900 shadow transition hover:bg-amber-400"
            >
              提領
            </button>
          </div>
        </div>
      ) : null}

      {claimCheckoutOpen ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-stone-900/50 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <div
            className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-stone-200 bg-white shadow-2xl sm:rounded-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="kol-claim-checkout-title"
          >
            <header className="flex items-center justify-between border-b border-stone-200 px-5 py-4">
              <div>
                <h3 id="kol-claim-checkout-title" className="text-lg font-bold text-stone-900">
                  批次提領／請款
                </h3>
                <p className="mt-0.5 text-xs text-stone-500">
                  {claimableSelected.length} 筆 · 未稅合計 NT$ {claimableSelectedTotal.toLocaleString("zh-TW")}
                </p>
              </div>
              <button
                type="button"
                disabled={claimSaving}
                onClick={() => setClaimCheckoutOpen(false)}
                className="rounded-xl border border-stone-300 px-3 py-1.5 text-sm font-semibold text-stone-600 hover:bg-stone-50 disabled:opacity-50"
              >
                關閉
              </button>
            </header>

            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
              <div className="inline-flex rounded-lg border border-stone-200 bg-stone-50 p-0.5 text-xs">
                {(["發票", "勞務報酬"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() =>
                      setClaimForm((f) => ({
                        ...f,
                        請款方式: mode,
                        勞報簽署: false,
                        勞報簽名: "",
                      }))
                    }
                    className={`rounded-md px-3 py-1.5 font-semibold transition ${
                      claimForm.請款方式 === mode ? "bg-amber-500 text-slate-900" : "text-stone-600 hover:text-stone-900"
                    }`}
                  >
                    {mode === "發票" ? "公司發票" : "勞務報酬單"}
                  </button>
                ))}
              </div>

              <div className="rounded-xl border border-stone-200 bg-stone-50/80 p-3">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-stone-500">勾選專案</p>
                <ul className="max-h-36 space-y-1 overflow-y-auto text-sm">
                  {claimableSelected.map((p) => (
                    <li key={p.專案ID} className="flex justify-between gap-2">
                      <span className="truncate text-stone-800">
                        <span className="font-mono text-xs text-stone-500">{p.專案ID}</span> {p.專案名稱}
                      </span>
                      <span className="shrink-0 tabular-nums font-semibold text-stone-900">
                        {parseKolAmount(p.KOL費用未稅).toLocaleString("zh-TW")}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              {claimForm.請款方式 === "發票" ? (
                <div className="space-y-3">
                  <p className="text-xs text-stone-500">同一張發票號碼與金額會自動套用到上方所有勾選專案。</p>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-stone-500">發票號碼</label>
                    <input
                      type="text"
                      value={claimForm.KOL發票號碼}
                      onChange={(e) => setClaimForm((f) => ({ ...f, KOL發票號碼: e.target.value }))}
                      className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm focus:border-amber-400 focus:outline-none"
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-stone-500">發票日期</label>
                      <input
                        type="date"
                        value={claimForm.KOL發票日期}
                        onChange={(e) => setClaimForm((f) => ({ ...f, KOL發票日期: e.target.value }))}
                        className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm focus:border-amber-400 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-stone-500">發票金額</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={claimForm.KOL發票金額}
                        onChange={(e) => setClaimForm((f) => ({ ...f, KOL發票金額: e.target.value }))}
                        className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm tabular-nums focus:border-amber-400 focus:outline-none"
                        placeholder="紙本／電子發票金額"
                      />
                    </div>
                  </div>
                  {(() => {
                    const entered = Math.round(Number(String(claimForm.KOL發票金額).replace(/,/g, "")) || 0);
                    if (!(entered > 0) || claimableSelectedTotal <= 0) return null;
                    const untaxed = claimableSelectedTotal;
                    const taxIncluded = Math.round(untaxed * 1.05);
                    const matches = entered === untaxed || entered === taxIncluded;
                    if (matches) {
                      return (
                        <p className="text-xs text-emerald-700">
                          已與系統合計對上
                          {entered === taxIncluded && entered !== untaxed ? "（含稅＝未稅×1.05）" : "（未稅）"}。
                        </p>
                      );
                    }
                    return (
                      <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-950 ring-1 ring-amber-200/80">
                        發票金額 NT$ {entered.toLocaleString("zh-TW")} 與系統未稅合計 NT${" "}
                        {untaxed.toLocaleString("zh-TW")}
                        （含稅預期 NT$ {taxIncluded.toLocaleString("zh-TW")}）不一致，仍可送出，請確認後再提領。
                      </p>
                    );
                  })()}
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-stone-500">備註</label>
                    <input
                      type="text"
                      value={claimForm.KOL發票備註}
                      onChange={(e) => setClaimForm((f) => ({ ...f, KOL發票備註: e.target.value }))}
                      className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm focus:border-amber-400 focus:outline-none"
                      placeholder="選填"
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs leading-relaxed text-stone-500">
                    系統會把合計拆成每張未滿 2 萬的勞報（預設每塊 NT$ {KOL_LABOR_SLIP_PREFERRED.toLocaleString("zh-TW")}
                    ），不做扣繳；一次簽名套用整批。
                  </p>
                  {claimLaborSplit ? (
                    <div className="rounded-xl border border-sky-200 bg-sky-50/80 p-3">
                      <p className="mb-2 text-xs font-bold text-sky-950">
                        拆單預覽 · {claimLaborSplit.slips.length} 張 · 合計 NT${" "}
                        {claimLaborSplit.total.toLocaleString("zh-TW")}
                      </p>
                      <ul className="max-h-40 space-y-1 overflow-y-auto text-xs tabular-nums text-sky-950">
                        {claimLaborSplit.slips.map((s) => (
                          <li key={s.序號} className="flex justify-between">
                            <span>單據 #{s.序號}</span>
                            <span className="font-semibold">{s.給付總額.toLocaleString("zh-TW")}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="text-sm text-red-600">無法計算拆單，請確認金額。</p>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-stone-500">勞務期間起</label>
                      <input
                        type="date"
                        value={claimForm.勞務期間起}
                        onChange={(e) => setClaimForm((f) => ({ ...f, 勞務期間起: e.target.value }))}
                        className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm focus:border-amber-400 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-stone-500">勞務期間迄</label>
                      <input
                        type="date"
                        value={claimForm.勞務期間迄}
                        onChange={(e) => setClaimForm((f) => ({ ...f, 勞務期間迄: e.target.value }))}
                        className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm focus:border-amber-400 focus:outline-none"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-stone-500">勞務內容</label>
                    <textarea
                      value={claimForm.勞務內容}
                      onChange={(e) => setClaimForm((f) => ({ ...f, 勞務內容: e.target.value }))}
                      rows={2}
                      className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm focus:border-amber-400 focus:outline-none"
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-stone-500">身分證字號</label>
                      <input
                        type="text"
                        value={claimForm.身分證字號}
                        onChange={(e) => setClaimForm((f) => ({ ...f, 身分證字號: e.target.value }))}
                        className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm focus:border-amber-400 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-stone-500">聯絡電話</label>
                      <input
                        type="text"
                        value={claimForm.聯絡電話}
                        onChange={(e) => setClaimForm((f) => ({ ...f, 聯絡電話: e.target.value }))}
                        className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm focus:border-amber-400 focus:outline-none"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-stone-500">戶籍地址</label>
                    <input
                      type="text"
                      value={claimForm.戶籍地址}
                      onChange={(e) => setClaimForm((f) => ({ ...f, 戶籍地址: e.target.value }))}
                      className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm focus:border-amber-400 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-stone-500">電子簽名（整批共用）</label>
                    <SignaturePad
                      value={claimForm.勞報簽名}
                      onChange={(v) => setClaimForm((f) => ({ ...f, 勞報簽名: v }))}
                      disabled={claimSaving}
                    />
                  </div>
                  <label className="flex cursor-pointer items-start gap-2 text-sm text-stone-700">
                    <input
                      type="checkbox"
                      checked={claimForm.勞報簽署}
                      onChange={(e) => setClaimForm((f) => ({ ...f, 勞報簽署: e.target.checked }))}
                      className="mt-1 h-4 w-4 rounded border-stone-300 text-amber-600"
                    />
                    <span>我確認以上勞務報酬內容正確，並同意以同一簽名套用至本批所有拆單據。</span>
                  </label>
                </div>
              )}

              {claimError ? <p className="text-sm font-medium text-red-600">{claimError}</p> : null}
            </div>

            <footer className="flex justify-end gap-3 border-t border-stone-200 px-5 py-4">
              <button
                type="button"
                disabled={claimSaving}
                onClick={() => setClaimCheckoutOpen(false)}
                className="rounded-xl border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-600 hover:bg-stone-50 disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                disabled={claimSaving}
                onClick={() => void submitClaimBatch()}
                className="rounded-xl bg-amber-500 px-5 py-2 text-sm font-bold text-slate-900 shadow hover:bg-amber-400 disabled:opacity-50"
              >
                {claimSaving ? "送出中…" : "確認提領"}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function KolHomePage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto flex min-h-screen max-w-6xl items-center justify-center px-4">
          <p className="text-sm text-stone-500">載入中…</p>
        </div>
      }
    >
      <KolHomeInner />
    </Suspense>
  );
}
