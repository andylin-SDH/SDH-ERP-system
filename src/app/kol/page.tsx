"use client";

import Image from "next/image";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseKolAmount } from "@/lib/kol/format";
import { SessionExpiryMonitor } from "@/components/SessionExpiryMonitor";
import { SignaturePad } from "@/components/SignaturePad";
import { useKolTheme } from "@/components/KolThemeShell";
import type { KolPortalProject } from "@/lib/kol/types";
import { kolHasRequestCredential, type KolRequestMode } from "@/lib/kol/finance-status";
import { calcLaborWithholding, type LaborPaymentMethod } from "@/lib/kol/labor-receipt";
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
  if (status === "未入帳") return "bg-stone-200 text-stone-800";
  if (status === "可請款") return "bg-sky-100 text-sky-950 ring-1 ring-sky-300/60";
  if (status === "待匯款") return "bg-amber-100 text-amber-950 ring-1 ring-amber-300/60";
  if (status === "已匯款") return "bg-emerald-100 text-emerald-900 ring-1 ring-emerald-300/50";
  return "bg-stone-100 text-stone-600";
}

type SettlementTab = "未入帳" | "可請款" | "待匯款" | "已匯款";

const SETTLEMENT_TABS: { key: SettlementTab; label: string; activeClass: string }[] = [
  { key: "未入帳", label: "未入帳", activeClass: "bg-stone-500 text-white shadow-sm" },
  { key: "可請款", label: "可請款", activeClass: "bg-sky-500 text-white shadow-sm" },
  { key: "待匯款", label: "待匯款", activeClass: "bg-amber-500 text-slate-900 shadow-sm" },
  { key: "已匯款", label: "已匯款", activeClass: "bg-emerald-600 text-white shadow-sm" },
];

type EditDraft = {
  請款方式: KolRequestMode;
  KOL發票號碼: string;
  KOL發票日期: string;
  KOL發票備註: string;
  勞務期間起: string;
  勞務期間迄: string;
  勞務內容: string;
  給付總額: string;
  身分證字號: string;
  勞報領款方式: LaborPaymentMethod;
  聯絡電話: string;
  戶籍地址: string;
  勞報簽名: string;
  勞報簽署: boolean;
};

function emptyDraft(p?: KolPortalProject, laborProfile?: KolLaborProfile): EditDraft {
  return {
    請款方式: p?.請款方式 ?? "發票",
    KOL發票號碼: p?.KOL發票號碼 ?? "",
    KOL發票日期: p?.KOL發票日期 ?? "",
    KOL發票備註: p?.KOL發票備註 ?? "",
    勞務期間起: p?.勞務期間起 ?? "",
    勞務期間迄: p?.勞務期間迄 ?? "",
    勞務內容: p?.勞務內容 || (p ? `${p.專案名稱} 業配執行` : ""),
    給付總額: p?.給付總額 || p?.KOL費用未稅 || "",
    身分證字號: p?.身分證字號 || laborProfile?.身分證字號 || "",
    勞報領款方式: p?.勞報領款方式 === "匯款" ? "匯款" : "現金",
    聯絡電話: p?.聯絡電話 || laborProfile?.聯絡電話 || "",
    戶籍地址: p?.戶籍地址 || laborProfile?.戶籍地址 || "",
    勞報簽名: "",
    勞報簽署: false,
  };
}

function LaborPayoutSummary({
  partnerName,
  projectName,
  grossAmount,
  laborContent,
  periodStart,
  periodEnd,
}: {
  partnerName: string;
  projectName: string;
  grossAmount: string;
  laborContent: string;
  periodStart: string;
  periodEnd: string;
}) {
  const w = calcLaborWithholding(grossAmount);
  return (
    <div className="rounded-lg border border-stone-200 bg-white px-3 py-3 text-sm text-stone-800">
      <p className="text-xs font-bold uppercase tracking-wide text-stone-500">本筆請款摘要</p>
      <dl className="mt-2 grid gap-1.5 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-stone-500">專案</dt>
          <dd className="font-semibold">{projectName}</dd>
        </div>
        <div>
          <dt className="text-stone-500">領款人</dt>
          <dd className="font-semibold">{partnerName}</dd>
        </div>
        <div>
          <dt className="text-stone-500">勞務期間</dt>
          <dd className="tabular-nums">{periodStart && periodEnd ? `${periodStart} ~ ${periodEnd}` : "—"}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-stone-500">勞務內容</dt>
          <dd>{laborContent || "—"}</dd>
        </div>
        <div>
          <dt className="text-stone-500">應領金額</dt>
          <dd className="font-bold tabular-nums">NT$ {w.應領金額.toLocaleString("zh-TW")}</dd>
        </div>
        <div>
          <dt className="text-stone-500">實領金額</dt>
          <dd className="font-bold tabular-nums text-emerald-800">NT$ {w.實領金額.toLocaleString("zh-TW")}</dd>
        </div>
      </dl>
    </div>
  );
}

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

function SdhOutboundInfoPanel({ p }: { p: KolPortalProject }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50/80 p-3">
      <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-stone-500">SDH對外請款（唯讀）</h3>
      {p.客戶端發票.length === 0 ? (
        <p className="text-sm text-stone-500">尚無對應發票</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {p.客戶端發票.map((inv, i) => (
            <li
              key={`${p.專案ID}-cinv-${i}`}
              className="rounded-md border border-stone-200 bg-white px-3 py-2"
            >
              <dl className="space-y-2">
                <div>
                  <dt className="text-xs text-stone-500">發票號碼</dt>
                  <dd className="mt-0.5 font-mono text-sm font-semibold text-stone-800">{inv.發票號碼}</dd>
                </div>
                <div>
                  <dt className="text-xs text-stone-500">發票日期</dt>
                  <dd className="mt-0.5 tabular-nums text-stone-800">{inv.發票日期}</dd>
                </div>
                <div>
                  <dt className="text-xs text-stone-500">含稅金額</dt>
                  <dd className="mt-0.5 font-semibold tabular-nums text-stone-900">{inv.發票金額含稅}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function KolRequestCredentialPanel({
  p,
  draft,
  saving,
  partnerName,
  onDraftChange,
  onSave,
}: {
  p: KolPortalProject;
  draft: EditDraft;
  saving: boolean;
  partnerName: string;
  onDraftChange: (next: EditDraft) => void;
  onSave: () => void;
}) {
  const showLaborReadonly = p.請款方式 === "勞務報酬" && Boolean(p.勞報簽署時間);
  const editingLabor = draft.請款方式 === "勞務報酬" && !showLaborReadonly;
  const lockedBeforeCredit = p.結帳狀態 === "未入帳";

  return (
    <div className="rounded-lg border border-amber-200/80 bg-amber-50/40 p-3">
      <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-amber-900">KOL 請款憑證</h3>
      {lockedBeforeCredit ? (
        <div className="rounded-lg border border-stone-200 bg-stone-50/90 px-3 py-3 text-sm text-stone-600">
          <p className="font-medium text-stone-800">尚未開放請款</p>
          <p className="mt-1 text-xs leading-relaxed">
            待財務確認客戶入帳並填寫<strong className="text-stone-700">客戶入帳日</strong>後，您即可填寫請款憑證（發票或勞務報酬單）。
          </p>
        </div>
      ) : !p.canEditKolInvoice ? (
        <p className="mb-2 text-xs text-stone-500">此專案已匯款，請款資料不可再修改。</p>
      ) : null}

      {!lockedBeforeCredit && (
        <>
      {p.canEditKolInvoice && !showLaborReadonly && (
        <div className="mb-3 inline-flex rounded-lg border border-stone-200 bg-white p-0.5 text-xs" onClick={(e) => e.stopPropagation()}>
          {(["發票", "勞務報酬"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onDraftChange({ ...draft, 請款方式: mode, 勞報簽署: false, 勞報簽名: "" })}
              className={`rounded-md px-3 py-1.5 font-semibold transition ${
                draft.請款方式 === mode ? "bg-amber-500 text-slate-900" : "text-stone-600 hover:text-stone-900"
              }`}
            >
              {mode === "發票" ? "公司發票" : "勞務報酬單"}
            </button>
          ))}
        </div>
      )}

      {showLaborReadonly ? (
        <div className="space-y-3">
          <LaborPayoutSummary
            partnerName={partnerName}
            projectName={p.專案名稱}
            grossAmount={p.給付總額}
            laborContent={p.勞務內容}
            periodStart={p.勞務期間起}
            periodEnd={p.勞務期間迄}
          />
          {p.勞報簽名 ? (
            <div className="rounded-lg border border-stone-200 bg-white px-3 py-2">
              <p className="text-xs text-stone-500">電子簽名</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.勞報簽名} alt="勞報電子簽名" className="mt-1 max-h-24 object-contain" />
            </div>
          ) : null}
          <p className="text-[11px] text-emerald-800">
            勞務報酬單已簽署送出（{p.勞報簽署時間.slice(0, 10) || "—"}）
          </p>
        </div>
      ) : editingLabor ? (
        <div className="space-y-3" onClick={(e) => e.stopPropagation()}>
          <LaborPayoutSummary
            partnerName={partnerName}
            projectName={p.專案名稱}
            grossAmount={draft.給付總額}
            laborContent={draft.勞務內容}
            periodStart={draft.勞務期間起}
            periodEnd={draft.勞務期間迄}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-xs font-medium text-stone-600">
              勞務期間（起）
              <input
                type="date"
                disabled={!p.canEditKolInvoice || saving}
                value={draft.勞務期間起}
                onChange={(e) => onDraftChange({ ...draft, 勞務期間起: e.target.value })}
                className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm disabled:opacity-60"
              />
            </label>
            <label className="block text-xs font-medium text-stone-600">
              勞務期間（迄）
              <input
                type="date"
                disabled={!p.canEditKolInvoice || saving}
                value={draft.勞務期間迄}
                onChange={(e) => onDraftChange({ ...draft, 勞務期間迄: e.target.value })}
                className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm disabled:opacity-60"
              />
            </label>
          </div>
          <label className="block text-xs font-medium text-stone-600">
            勞務內容（領款說明）
            <input
              type="text"
              disabled={!p.canEditKolInvoice || saving}
              value={draft.勞務內容}
              onChange={(e) => onDraftChange({ ...draft, 勞務內容: e.target.value })}
              className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm disabled:opacity-60"
            />
          </label>
          <label className="block text-xs font-medium text-stone-600">
            應領金額 NT$（未稅）
            <input
              type="text"
              disabled={!p.canEditKolInvoice || saving}
              value={draft.給付總額}
              onChange={(e) => onDraftChange({ ...draft, 給付總額: e.target.value })}
              className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm tabular-nums disabled:opacity-60"
            />
          </label>

          <div className="rounded-lg border border-amber-100 bg-amber-50/50 px-3 py-3">
            <p className="mb-2 text-xs font-bold text-amber-950">我的資料（填寫一次後自動帶入）</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block text-xs font-medium text-stone-600 sm:col-span-2">
                身分證字號
                <input
                  type="text"
                  disabled={!p.canEditKolInvoice || saving}
                  value={draft.身分證字號}
                  onChange={(e) => onDraftChange({ ...draft, 身分證字號: e.target.value.toUpperCase() })}
                  className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 font-mono text-sm uppercase disabled:opacity-60"
                  placeholder="A123456789"
                />
              </label>
              <label className="block text-xs font-medium text-stone-600">
                聯絡電話
                <input
                  type="tel"
                  disabled={!p.canEditKolInvoice || saving}
                  value={draft.聯絡電話}
                  onChange={(e) => onDraftChange({ ...draft, 聯絡電話: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm disabled:opacity-60"
                />
              </label>
              <label className="block text-xs font-medium text-stone-600">
                戶籍地址
                <input
                  type="text"
                  disabled={!p.canEditKolInvoice || saving}
                  value={draft.戶籍地址}
                  onChange={(e) => onDraftChange({ ...draft, 戶籍地址: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm disabled:opacity-60"
                />
              </label>
            </div>
          </div>

          <label className="block text-xs font-medium text-stone-600">
            備註
            <input
              type="text"
              disabled={!p.canEditKolInvoice || saving}
              value={draft.KOL發票備註}
              onChange={(e) => onDraftChange({ ...draft, KOL發票備註: e.target.value })}
              className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm disabled:opacity-60"
            />
          </label>

          {p.canEditKolInvoice ? (
            <SignaturePad
              value={draft.勞報簽名}
              disabled={saving}
              onChange={(sig) => onDraftChange({ ...draft, 勞報簽名: sig })}
            />
          ) : null}

          {p.canEditKolInvoice && (
            <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs text-stone-700">
              <input
                type="checkbox"
                checked={draft.勞報簽署}
                disabled={saving}
                onChange={(e) => onDraftChange({ ...draft, 勞報簽署: e.target.checked })}
                className="mt-0.5"
              />
              <span>本人確認以上內容正確，並同意以此向盛德好請款。</span>
            </label>
          )}
          {p.canEditKolInvoice && (
            <button
              type="button"
              disabled={saving || !draft.勞報簽署 || !draft.勞報簽名}
              onClick={(e) => {
                e.stopPropagation();
                onSave();
              }}
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-slate-900 hover:bg-amber-400 disabled:opacity-60"
            >
              {saving ? "送出中…" : "簽署並送出勞務報酬單"}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <label className="block text-xs font-medium text-stone-600">
            發票號碼
            <input
              type="text"
              disabled={!p.canEditKolInvoice || saving}
              value={draft.KOL發票號碼}
              onChange={(e) => onDraftChange({ ...draft, KOL發票號碼: e.target.value })}
              onClick={(e) => e.stopPropagation()}
              className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 font-mono text-sm disabled:opacity-60"
              placeholder="例：AB-12345678"
            />
          </label>
          <label className="block text-xs font-medium text-stone-600">
            發票日期
            <input
              type="date"
              disabled={!p.canEditKolInvoice || saving}
              value={draft.KOL發票日期}
              onChange={(e) => onDraftChange({ ...draft, KOL發票日期: e.target.value })}
              onClick={(e) => e.stopPropagation()}
              className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm disabled:opacity-60"
            />
          </label>
          <label className="block text-xs font-medium text-stone-600">
            備註
            <input
              type="text"
              disabled={!p.canEditKolInvoice || saving}
              value={draft.KOL發票備註}
              onChange={(e) => onDraftChange({ ...draft, KOL發票備註: e.target.value })}
              onClick={(e) => e.stopPropagation()}
              className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm disabled:opacity-60"
            />
          </label>
          {p.canEditKolInvoice && (
            <button
              type="button"
              disabled={saving}
              onClick={(e) => {
                e.stopPropagation();
                onSave();
              }}
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-slate-900 hover:bg-amber-400 disabled:opacity-60"
            >
              {saving ? "儲存中…" : "儲存 KOL 發票"}
            </button>
          )}
        </div>
      )}

      {p.KOL發票填寫人 ? (
        <p className="mt-2 text-[11px] text-stone-500">
          最後更新：{p.KOL發票填寫來源} · {p.KOL發票填寫人}
        </p>
      ) : null}
        </>
      )}

      {p.結帳狀態 === "已匯款" && (
        <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50/80 px-3 py-2 text-sm text-emerald-950">
          <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">匯款資訊</p>
          <p className="mt-1">
            結帳日期：<span className="font-semibold tabular-nums">{p.KOL匯款日期}</span>
          </p>
          {p.KOL匯款金額 ? (
            <p>
              匯款金額：<span className="font-semibold tabular-nums">{p.KOL匯款金額}</span>
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
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
    status: "未入帳",
    action: "等客戶付款入帳；財務填寫客戶入帳日後，才會開放請款。",
    bar: "border-l-stone-400",
    num: "bg-stone-100 text-stone-700",
  },
  {
    status: "可請款",
    action: "展開專案填請款資料：公司戶填發票，個人戶簽署勞務報酬單。",
    bar: "border-l-sky-400",
    num: "bg-sky-100 text-sky-800",
  },
  {
    status: "待匯款",
    action: "已送出，SDH 將於收到發票後隔月 5 號前匯款；資料有誤請聯絡財務。",
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
        看列表「結帳狀態」對照下方四步；需要操作時，點專案列展開即可。
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

export default function KolHomePage() {
  const { isDark } = useKolTheme();
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
  const [settlementTab, setSettlementTab] = useState<SettlementTab>("未入帳");
  const [sessionActive, setSessionActive] = useState(false);
  const [expandedPid, setExpandedPid] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, EditDraft>>({});
  const [savingPid, setSavingPid] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const loadSeqRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 45000);
    try {
      const res = await fetch("/api/kol/overview", {
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
        window.location.href = "/";
        return;
      }
      if (res.status === 403) {
        setError(data.error ?? "此帳號不是 KOL 專用入口，請聯絡管理員。");
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
      const list = Array.isArray(data.projects) ? data.projects : [];
      setProjects(list);
      const nextDrafts: Record<string, EditDraft> = {};
      for (const p of list) {
        nextDrafts[p.專案ID] = emptyDraft(p, profile);
      }
      setDrafts(nextDrafts);
      setSessionActive(true);
    } catch (e) {
      if (seq !== loadSeqRef.current) return;
      if (e instanceof DOMException && e.name === "AbortError") {
        setError("載入逾時（超過 45 秒），請檢查網路後按「重新整理」。");
      } else {
        setError(e instanceof Error ? e.message : "無法載入資料，請稍後再試。");
      }
    } finally {
      window.clearTimeout(timeoutId);
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, []);

  const handleSessionEnd = useCallback(() => {
    setSessionActive(false);
    window.location.href = "/";
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const projectsBySettlement = useMemo(() => {
    const buckets: Record<SettlementTab, KolPortalProject[]> = {
      未入帳: [],
      可請款: [],
      待匯款: [],
      已匯款: [],
    };
    for (const p of projects) {
      const key = (["未入帳", "可請款", "待匯款", "已匯款"] as const).includes(
        p.結帳狀態 as SettlementTab
      )
        ? (p.結帳狀態 as SettlementTab)
        : "未入帳";
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
  const settlementTabInitialized = useRef(false);

  useEffect(() => {
    if (projects.length === 0 || settlementTabInitialized.current) return;
    const preferred: SettlementTab[] = ["可請款", "待匯款", "未入帳", "已匯款"];
    const firstWithItems = preferred.find((k) => projectsBySettlement[k].length > 0);
    if (firstWithItems) setSettlementTab(firstWithItems);
    settlementTabInitialized.current = true;
  }, [projects.length, projectsBySettlement]);

  async function saveKolInvoice(p: KolPortalProject) {
    const draft = drafts[p.專案ID] ?? emptyDraft(p);
    setSavingPid(p.專案ID);
    setSaveNotice(null);
    try {
      const isLabor = draft.請款方式 === "勞務報酬";
      const res = await fetch("/api/kol/invoices", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isLabor
            ? {
                專案ID: p.專案ID,
                請款方式: "勞務報酬",
                勞務期間起: draft.勞務期間起.trim() || null,
                勞務期間迄: draft.勞務期間迄.trim() || null,
                勞務內容: draft.勞務內容.trim() || null,
                給付總額: draft.給付總額.trim() || null,
                身分證字號: draft.身分證字號.trim() || null,
                領款方式: "現金",
                聯絡電話: draft.聯絡電話.trim() || null,
                戶籍地址: draft.戶籍地址.trim() || null,
                KOL發票備註: draft.KOL發票備註.trim() || null,
                勞報簽署: draft.勞報簽署,
                勞報簽名: draft.勞報簽名.trim() || null,
              }
            : {
                專案ID: p.專案ID,
                請款方式: "發票",
                KOL發票號碼: draft.KOL發票號碼.trim() || null,
                KOL發票日期: draft.KOL發票日期.trim() || null,
                KOL發票備註: draft.KOL發票備註.trim() || null,
              }
        ),
      });
      const data = (await safeResJson(res)) as { ok?: boolean; error?: string; updated?: number };
      if (!res.ok || !data.ok) {
        setSaveNotice(data.error ?? "儲存失敗");
        return;
      }
      setSaveNotice(isLabor ? "勞務報酬單已簽署並送出" : "KOL 發票已儲存");
      await load();
    } catch (e) {
      setSaveNotice(e instanceof Error ? e.message : "儲存失敗");
    } finally {
      setSavingPid(null);
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/session", { method: "DELETE", credentials: "include" });
    window.location.href = "/";
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-8 sm:px-6">
      <SessionExpiryMonitor active={sessionActive && !loading && !error} onSessionEnd={handleSessionEnd} />
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
              我的專案
            </h1>
            <p className={`text-xs ${isDark ? "text-stone-500" : "text-stone-500"}`}>
              結帳狀態：未入帳 → 可請款 → 待匯款 → 已匯款
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className={
              isDark
                ? "rounded-xl border border-amber-400/40 bg-amber-500/15 px-4 py-2 text-sm font-semibold text-amber-200 transition hover:bg-amber-500/25 disabled:opacity-50"
                : "rounded-xl border border-amber-300/80 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-950 shadow-sm hover:bg-amber-100 disabled:opacity-50"
            }
          >
            重新整理
          </button>
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
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  aria-hidden
                  className={isDark ? "text-amber-300" : "text-amber-700"}
                >
                  <path
                    d="M6 4l4 4-4 4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                點選專案列可展開詳情
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
                    <th className="w-9 px-2 py-3" aria-hidden />
                    <th className="whitespace-nowrap px-3 py-3 text-xs font-bold tracking-wide">專案ID</th>
                    <th className="min-w-[140px] px-3 py-3 text-xs font-bold tracking-wide">專案名稱</th>
                    <th className="whitespace-nowrap px-3 py-3 text-xs font-bold tracking-wide">結帳狀態</th>
                    <th className="whitespace-nowrap px-3 py-3 text-xs font-bold tracking-wide">KOL分潤金額未稅</th>
                    <th className="whitespace-nowrap px-3 py-3 text-xs font-bold tracking-wide">專案總金額未稅</th>
                    <th className="whitespace-nowrap px-3 py-3 text-xs font-bold tracking-wide">請款憑證</th>
                    <th className="whitespace-nowrap px-3 py-3 text-xs font-bold tracking-wide">客戶入帳日</th>
                    <th className="whitespace-nowrap px-3 py-3 text-xs font-bold tracking-wide">結帳日期</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleProjects.map((p) => {
                    const expanded = expandedPid === p.專案ID;
                    const draft = drafts[p.專案ID] ?? emptyDraft(p, laborProfile);
                    const needsAction = p.結帳狀態 === "可請款" && !projectHasCredential(p);
                    return (
                      <Fragment key={p.專案ID}>
                        <tr
                          role="button"
                          tabIndex={0}
                          aria-expanded={expanded}
                          aria-label={`${p.專案名稱}，${expanded ? "收合" : "展開"}專案詳情`}
                          className={`group cursor-pointer border-b transition-all last:border-b-0 ${
                            isDark
                              ? expanded
                                ? "border-white/10 bg-amber-500/10 shadow-[inset_3px_0_0_0] shadow-amber-400"
                                : needsAction
                                  ? "border-white/5 bg-[#141414] hover:bg-sky-500/10 hover:shadow-[inset_3px_0_0_0] hover:shadow-sky-400"
                                  : "border-white/5 bg-[#121212] even:bg-[#161616] hover:bg-amber-500/10 hover:shadow-[inset_3px_0_0_0] hover:shadow-amber-400"
                              : expanded
                                ? "border-stone-100 bg-amber-50/90 shadow-[inset_3px_0_0_0] shadow-amber-500"
                                : needsAction
                                  ? "border-stone-100 bg-white hover:bg-sky-50/50 hover:shadow-[inset_3px_0_0_0] hover:shadow-sky-400"
                                  : "border-stone-100 bg-white even:bg-stone-50/40 hover:bg-amber-50/70 hover:shadow-[inset_3px_0_0_0] hover:shadow-amber-400"
                          }`}
                          onClick={() => setExpandedPid(expanded ? null : p.專案ID)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setExpandedPid(expanded ? null : p.專案ID);
                            }
                          }}
                        >
                          <td className="px-2 py-3 text-center">
                            <span
                              className={`inline-flex h-6 w-6 items-center justify-center rounded-full transition ${
                                expanded
                                  ? "rotate-90 bg-amber-500 text-slate-900"
                                  : isDark
                                    ? "bg-white/10 text-stone-400 group-hover:bg-amber-500/30 group-hover:text-amber-100"
                                    : "bg-stone-100 text-stone-500 group-hover:bg-amber-200 group-hover:text-amber-950"
                              }`}
                              aria-hidden
                            >
                              <svg width="12" height="12" viewBox="0 0 16 16">
                                <path
                                  d="M6 4l4 4-4 4"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            </span>
                          </td>
                          <td
                            className={`whitespace-nowrap px-3 py-3.5 font-mono text-[11px] ${
                              isDark ? "text-stone-500 group-hover:text-stone-300" : "text-stone-600 group-hover:text-stone-800"
                            }`}
                          >
                            {p.專案ID}
                          </td>
                          <td className="max-w-[220px] px-3 py-3.5">
                            <p
                              className={`font-semibold ${
                                isDark
                                  ? "text-stone-100 group-hover:text-amber-100"
                                  : "text-stone-900 group-hover:text-amber-950"
                              }`}
                            >
                              {p.專案名稱}
                            </p>
                            <p
                              className={`mt-0.5 text-[10px] opacity-0 transition group-hover:opacity-100 ${
                                isDark ? "text-stone-500" : "text-stone-400"
                              }`}
                            >
                              {expanded ? "點一下收合" : "點一下展開"}
                            </p>
                          </td>
                          <td className="whitespace-nowrap px-3 py-3.5">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${settlementBadgeClass(p.結帳狀態)}`}
                            >
                              {p.結帳狀態}
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
                          <td className="whitespace-nowrap px-3 py-3.5 text-xs">
                            {p.請款憑證摘要 ? (
                              <span className={isDark ? "text-stone-200" : "text-stone-800"}>
                                <span className={isDark ? "text-stone-500" : "text-stone-500"}>
                                  {p.請款方式 === "勞務報酬" ? "勞報" : "發票"}
                                </span>
                                <span className="ml-1 font-mono font-semibold">{p.請款憑證摘要}</span>
                              </span>
                            ) : needsAction ? (
                              <span
                                className={`inline-flex rounded-md px-2 py-0.5 font-semibold ring-1 ${
                                  isDark
                                    ? "bg-rose-500/15 text-rose-300 ring-rose-400/30"
                                    : "bg-red-50 text-red-700 ring-red-200/80"
                                }`}
                              >
                                待填
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
                            {p.KOL匯款日期 || (p.結帳狀態 === "待匯款" ? (
                              <span className={isDark ? "text-amber-300" : "text-amber-700"}>待匯款</span>
                            ) : (
                              "—"
                            ))}
                          </td>
                        </tr>
                        {expanded && (
                          <tr
                            className={
                              isDark
                                ? "border-b border-white/10 bg-[#0f0f0f]"
                                : "border-b border-amber-100 bg-gradient-to-b from-amber-50/40 to-white"
                            }
                          >
                            <td colSpan={9} className="px-4 py-4">
                              <p
                                className={`mb-3 text-xs font-bold uppercase tracking-wide ${
                                  isDark ? "text-amber-200/80" : "text-amber-800/80"
                                }`}
                              >
                                專案詳情 · {p.專案ID}
                              </p>
                              <div className="grid grid-cols-2 gap-4">
                                <SdhOutboundInfoPanel p={p} />
                                <KolRequestCredentialPanel
                                  p={p}
                                  draft={draft}
                                  saving={savingPid === p.專案ID}
                                  partnerName={partnerName}
                                  onDraftChange={(next) =>
                                    setDrafts((prev) => ({ ...prev, [p.專案ID]: next }))
                                  }
                                  onSave={() => void saveKolInvoice(p)}
                                />
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
