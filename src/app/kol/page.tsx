"use client";

import Image from "next/image";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { parseKolAmount } from "@/lib/kol/format";
import { isKolProjectInProgress } from "@/lib/kol/project-lifecycle";
import { SessionExpiryMonitor } from "@/components/SessionExpiryMonitor";
import type { KolPortalProject } from "@/lib/kol/types";

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
  if (status === "可提領") return "bg-amber-100 text-amber-950 ring-1 ring-amber-300/60";
  if (status === "已分潤") return "bg-emerald-100 text-emerald-900 ring-1 ring-emerald-300/50";
  return "bg-stone-100 text-stone-600";
}

type LifecycleTab = "in_progress" | "completed";

type EditDraft = {
  KOL發票號碼: string;
  KOL發票日期: string;
  KOL發票備註: string;
  applyToOthers: boolean;
};

function emptyDraft(): EditDraft {
  return { KOL發票號碼: "", KOL發票日期: "", KOL發票備註: "", applyToOthers: false };
}

export default function KolHomePage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [partnerName, setPartnerName] = useState<string>("");
  const [partnerId, setPartnerId] = useState<string>("");
  const [projects, setProjects] = useState<KolPortalProject[]>([]);
  const [lifecycleTab, setLifecycleTab] = useState<LifecycleTab>("in_progress");
  const [sessionActive, setSessionActive] = useState(false);
  const [expandedPid, setExpandedPid] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, EditDraft>>({});
  const [savingPid, setSavingPid] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/kol/overview", { credentials: "include", cache: "no-store" });
    const data = (await safeResJson(res)) as {
      ok?: boolean;
      error?: string;
      partnerName?: string;
      partnerId?: string;
      projects?: KolPortalProject[];
    };
    if (res.status === 401) {
      window.location.href = "/";
      return;
    }
    if (res.status === 403) {
      setError(data.error ?? "此帳號不是 KOL 專用入口，請聯絡管理員。");
      setLoading(false);
      return;
    }
    if (!res.ok || !data.ok) {
      setError(data.error ?? "無法載入資料");
      setLoading(false);
      return;
    }
    setPartnerName(data.partnerName ?? "");
    setPartnerId(data.partnerId ?? "");
    const list = Array.isArray(data.projects) ? data.projects : [];
    setProjects(list);
    const nextDrafts: Record<string, EditDraft> = {};
    for (const p of list) {
      nextDrafts[p.專案ID] = {
        KOL發票號碼: p.KOL發票號碼 ?? "",
        KOL發票日期: p.KOL發票日期 ?? "",
        KOL發票備註: p.KOL發票備註 ?? "",
        applyToOthers: false,
      };
    }
    setDrafts(nextDrafts);
    setSessionActive(true);
    setLoading(false);
  }, []);

  const handleSessionEnd = useCallback(() => {
    setSessionActive(false);
    window.location.href = "/";
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const inProgressProjects = useMemo(
    () => projects.filter((p) => isKolProjectInProgress(p.專案狀態)),
    [projects]
  );
  const completedProjects = useMemo(
    () => projects.filter((p) => !isKolProjectInProgress(p.專案狀態)),
    [projects]
  );

  const summary = useMemo(() => {
    let kolFeeSum = 0;
    let pendingSettlement = 0;
    let missingKolInvoice = 0;
    for (const p of inProgressProjects) {
      kolFeeSum += parseKolAmount(p.KOL費用未稅);
      if (p.結帳狀態 === "未入帳") pendingSettlement += 1;
      if (p.結帳狀態 !== "未入帳" && !p.KOL發票號碼.trim()) missingKolInvoice += 1;
    }
    return { inProgressCount: inProgressProjects.length, kolFeeSum, pendingSettlement, missingKolInvoice };
  }, [inProgressProjects]);

  const visibleProjects = lifecycleTab === "in_progress" ? inProgressProjects : completedProjects;

  const batchApplyCandidates = useCallback(
    (p: KolPortalProject) => {
      const num = (drafts[p.專案ID]?.KOL發票號碼 ?? p.KOL發票號碼 ?? "").trim();
      if (!num) return [];
      return visibleProjects.filter(
        (x) =>
          x.專案ID !== p.專案ID &&
          x.canEditKolInvoice &&
          !x.KOL發票號碼.trim()
      );
    },
    [drafts, visibleProjects]
  );

  async function saveKolInvoice(p: KolPortalProject) {
    const draft = drafts[p.專案ID] ?? emptyDraft();
    setSavingPid(p.專案ID);
    setSaveNotice(null);
    try {
      const applyToProjectIds = draft.applyToOthers
        ? batchApplyCandidates(p).map((x) => x.專案ID)
        : [];
      const res = await fetch("/api/kol/invoices", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          專案ID: p.專案ID,
          KOL發票號碼: draft.KOL發票號碼.trim() || null,
          KOL發票日期: draft.KOL發票日期.trim() || null,
          KOL發票備註: draft.KOL發票備註.trim() || null,
          applyToProjectIds,
        }),
      });
      const data = (await safeResJson(res)) as { ok?: boolean; error?: string; updated?: number };
      if (!res.ok || !data.ok) {
        setSaveNotice(data.error ?? "儲存失敗");
        return;
      }
      setSaveNotice(
        data.updated && data.updated > 1
          ? `已儲存，並套用到 ${data.updated} 個專案`
          : "KOL 發票已儲存"
      );
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
      <header className="mb-8 flex flex-col gap-4 border-b border-amber-200/80 pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Image src="/logo.png" alt="SDH" width={200} height={48} className="h-10 w-auto object-contain" />
          <div>
            <h1 className="text-lg font-bold tracking-tight text-stone-900">我的專案</h1>
            <p className="text-xs text-stone-500">結帳狀態依財務入帳更新 · 可填寫 KOL 請款發票</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded-xl border border-amber-300/80 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-950 shadow-sm hover:bg-amber-100 disabled:opacity-50"
          >
            重新整理
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-xl border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-600 shadow-sm hover:bg-stone-50"
          >
            登出
          </button>
        </div>
      </header>

      {loading && <p className="text-stone-500">載入中…</p>}
      {error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">{error}</div>
      )}
      {saveNotice && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {saveNotice}
        </div>
      )}

      {!loading && !error && (
        <>
          <p className="mb-4 text-sm text-stone-600">
            <span className="font-semibold text-stone-800">{partnerName || "—"}</span>
            {partnerId ? <span className="ml-2 text-stone-500">（{partnerId}）</span> : null}
          </p>

          <div className="mb-6 grid gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-stone-200/90 bg-white/90 px-4 py-3 shadow-sm ring-1 ring-amber-100/40">
              <p className="text-xs font-medium text-stone-500">進行中專案</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-stone-900">{summary.inProgressCount}</p>
            </div>
            <div className="rounded-xl border border-stone-200/90 bg-white/90 px-4 py-3 shadow-sm ring-1 ring-amber-100/40">
              <p className="text-xs font-medium text-stone-500">進行中 KOL 費用未稅合計</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-stone-900">
                {summary.kolFeeSum > 0 ? summary.kolFeeSum.toLocaleString("zh-TW") : "—"}
              </p>
            </div>
            <div className="rounded-xl border border-stone-200/90 bg-white/90 px-4 py-3 shadow-sm ring-1 ring-amber-100/40">
              <p className="text-xs font-medium text-stone-500">進行中 · 未入帳</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-amber-900">{summary.pendingSettlement}</p>
            </div>
            <div className="rounded-xl border border-stone-200/90 bg-white/90 px-4 py-3 shadow-sm ring-1 ring-amber-100/40">
              <p className="text-xs font-medium text-stone-500">已入帳 · 待填 KOL 發票</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-red-700">{summary.missingKolInvoice}</p>
            </div>
          </div>

          <p className="mb-4 text-xs leading-relaxed text-stone-500">
            點專案列可展開：<strong className="text-stone-700">客戶端發票</strong>（唯讀）與
            <strong className="text-stone-700"> KOL 請款發票</strong>（可填寫）。同一張 KOL 發票若涵蓋多案，可勾選「套用到其他未填專案」。
          </p>

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-stone-200 bg-stone-100/80 p-0.5 text-sm">
              <button
                type="button"
                onClick={() => setLifecycleTab("in_progress")}
                className={`rounded-md px-3 py-1.5 font-semibold transition ${
                  lifecycleTab === "in_progress"
                    ? "bg-amber-500 text-slate-900 shadow-sm"
                    : "text-stone-600 hover:text-stone-900"
                }`}
              >
                進行中
                <span className="ml-1.5 text-xs font-normal opacity-80">({inProgressProjects.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setLifecycleTab("completed")}
                className={`rounded-md px-3 py-1.5 font-semibold transition ${
                  lifecycleTab === "completed"
                    ? "bg-stone-600 text-white shadow-sm"
                    : "text-stone-600 hover:text-stone-900"
                }`}
              >
                已結案
                <span className="ml-1.5 text-xs font-normal opacity-80">({completedProjects.length})</span>
              </button>
            </div>
          </div>

          {projects.length === 0 ? (
            <p className="rounded-xl border border-stone-200 bg-white/80 px-4 py-10 text-center text-stone-500">
              目前沒有與您對應的專案。請確認大總表「KOL 名稱」與您的合作夥伴名稱一致。
            </p>
          ) : visibleProjects.length === 0 ? (
            <p className="rounded-xl border border-stone-200 bg-white/80 px-4 py-10 text-center text-stone-500">
              {lifecycleTab === "in_progress" ? "目前沒有進行中的專案。" : "目前沒有已結案的專案。"}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-stone-200/90 bg-white/90 shadow-sm ring-1 ring-amber-100/50">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-amber-100/90 text-amber-950">
                  <tr>
                    <th className="whitespace-nowrap px-3 py-3 font-semibold">專案ID</th>
                    <th className="min-w-[140px] px-3 py-3 font-semibold">專案名稱</th>
                    <th className="whitespace-nowrap px-3 py-3 font-semibold">結帳狀態</th>
                    <th className="whitespace-nowrap px-3 py-3 font-semibold">KOL費用未稅</th>
                    <th className="whitespace-nowrap px-3 py-3 font-semibold">客戶發票</th>
                    <th className="whitespace-nowrap px-3 py-3 font-semibold">KOL發票號碼</th>
                    <th className="whitespace-nowrap px-3 py-3 font-semibold">廠商入帳日</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200">
                  {visibleProjects.map((p) => {
                    const expanded = expandedPid === p.專案ID;
                    const draft = drafts[p.專案ID] ?? emptyDraft();
                    const applyList = batchApplyCandidates(p);
                    return (
                      <Fragment key={p.專案ID}>
                        <tr
                          className="cursor-pointer bg-amber-50/30 hover:bg-amber-50/60"
                          onClick={() => setExpandedPid(expanded ? null : p.專案ID)}
                        >
                          <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-stone-800">{p.專案ID}</td>
                          <td className="max-w-[220px] px-3 py-3 text-stone-800">{p.專案名稱}</td>
                          <td className="whitespace-nowrap px-3 py-3">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${settlementBadgeClass(p.結帳狀態)}`}
                            >
                              {p.結帳狀態}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 tabular-nums text-stone-900">{p.KOL費用未稅}</td>
                          <td className="whitespace-nowrap px-3 py-3 text-xs text-stone-600">
                            {p.發票筆數 > 0 ? `${p.發票筆數} 張 · ${p.發票已開含稅合計}` : "—"}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-stone-800">
                            {p.KOL發票號碼.trim() || (
                              <span className="text-red-600">{p.結帳狀態 !== "未入帳" ? "待填" : "—"}</span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 tabular-nums text-stone-700">{p.廠商付款日期}</td>
                        </tr>
                        {expanded && (
                          <tr className="bg-white">
                            <td colSpan={7} className="px-4 py-4">
                              <div className="grid gap-4 lg:grid-cols-2">
                                <div className="rounded-lg border border-stone-200 bg-stone-50/80 p-3">
                                  <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-stone-500">
                                    客戶端 · 我們收款（唯讀）
                                  </h3>
                                  {p.客戶端發票.length === 0 ? (
                                    <p className="text-sm text-stone-500">尚無對應發票</p>
                                  ) : (
                                    <ul className="space-y-2 text-sm">
                                      {p.客戶端發票.map((inv, i) => (
                                        <li key={`${p.專案ID}-cinv-${i}`} className="rounded-md border border-stone-200 bg-white px-3 py-2">
                                          <span className="font-mono font-semibold text-stone-800">{inv.發票號碼}</span>
                                          <span className="ml-2 text-stone-500">{inv.發票日期}</span>
                                          <span className="ml-2 tabular-nums text-stone-700">含稅 {inv.發票金額含稅}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                                <div className="rounded-lg border border-amber-200/80 bg-amber-50/40 p-3">
                                  <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-amber-900">
                                    KOL 請款發票
                                  </h3>
                                  {!p.canEditKolInvoice ? (
                                    <p className="mb-2 text-xs text-stone-500">此專案已分潤，發票資料不可再修改。</p>
                                  ) : null}
                                  <div className="space-y-2">
                                    <label className="block text-xs font-medium text-stone-600">
                                      發票號碼
                                      <input
                                        type="text"
                                        disabled={!p.canEditKolInvoice || savingPid === p.專案ID}
                                        value={draft.KOL發票號碼}
                                        onChange={(e) =>
                                          setDrafts((prev) => ({
                                            ...prev,
                                            [p.專案ID]: { ...draft, KOL發票號碼: e.target.value },
                                          }))
                                        }
                                        onClick={(e) => e.stopPropagation()}
                                        className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 font-mono text-sm disabled:opacity-60"
                                        placeholder="例：AB-12345678"
                                      />
                                    </label>
                                    <label className="block text-xs font-medium text-stone-600">
                                      發票日期
                                      <input
                                        type="date"
                                        disabled={!p.canEditKolInvoice || savingPid === p.專案ID}
                                        value={draft.KOL發票日期}
                                        onChange={(e) =>
                                          setDrafts((prev) => ({
                                            ...prev,
                                            [p.專案ID]: { ...draft, KOL發票日期: e.target.value },
                                          }))
                                        }
                                        onClick={(e) => e.stopPropagation()}
                                        className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm disabled:opacity-60"
                                      />
                                    </label>
                                    <label className="block text-xs font-medium text-stone-600">
                                      備註
                                      <input
                                        type="text"
                                        disabled={!p.canEditKolInvoice || savingPid === p.專案ID}
                                        value={draft.KOL發票備註}
                                        onChange={(e) =>
                                          setDrafts((prev) => ({
                                            ...prev,
                                            [p.專案ID]: { ...draft, KOL發票備註: e.target.value },
                                          }))
                                        }
                                        onClick={(e) => e.stopPropagation()}
                                        className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm disabled:opacity-60"
                                      />
                                    </label>
                                    {p.canEditKolInvoice && applyList.length > 0 && draft.KOL發票號碼.trim() && (
                                      <label className="flex cursor-pointer items-start gap-2 text-xs text-stone-600">
                                        <input
                                          type="checkbox"
                                          checked={draft.applyToOthers}
                                          onChange={(e) =>
                                            setDrafts((prev) => ({
                                              ...prev,
                                              [p.專案ID]: { ...draft, applyToOthers: e.target.checked },
                                            }))
                                          }
                                          onClick={(e) => e.stopPropagation()}
                                          className="mt-0.5"
                                        />
                                        <span>
                                          同一張發票套用到其他 {applyList.length} 個未填號碼的專案
                                        </span>
                                      </label>
                                    )}
                                    {p.KOL發票填寫人 && (
                                      <p className="text-[11px] text-stone-500">
                                        最後更新：{p.KOL發票填寫來源} · {p.KOL發票填寫人}
                                      </p>
                                    )}
                                    {p.canEditKolInvoice && (
                                      <button
                                        type="button"
                                        disabled={savingPid === p.專案ID}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          void saveKolInvoice(p);
                                        }}
                                        className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-slate-900 hover:bg-amber-400 disabled:opacity-60"
                                      >
                                        {savingPid === p.專案ID ? "儲存中…" : "儲存 KOL 發票"}
                                      </button>
                                    )}
                                  </div>
                                </div>
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
