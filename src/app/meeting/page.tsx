"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { fetchSessionWithRetry } from "@/components/ErpLoginPanel";
import { MeetingProjectDetail } from "@/components/meeting/MeetingProjectDetail";
import { financeProgressBadgeClass } from "@/lib/meeting/ui";
import type { MeetingProjectItem, MeetingSnapshot, PersonWorkloadGroup } from "@/lib/meeting/types";

const UNASSIGNED_KEY = "（未指定主責）";

async function safeResJson(r: Response): Promise<Record<string, unknown>> {
  const text = await r.text();
  if (!text.trim()) return {};
  try {
    return (JSON.parse(text) as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

async function fetchMeetingSnapshot(): Promise<{ ok: true; snapshot: MeetingSnapshot } | { ok: false; error: string }> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 90000);
  try {
    const res = await fetch("/api/meeting", {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    });
    const data = (await safeResJson(res)) as { ok?: boolean; snapshot?: MeetingSnapshot; error?: string };
    if (!res.ok || !data.ok || !data.snapshot) {
      return { ok: false, error: data.error ?? `無法載入晨會資料（HTTP ${res.status}）` };
    }
    return { ok: true, snapshot: data.snapshot };
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      return { ok: false, error: "載入逾時（超過 90 秒），請重試或重啟本機 dev server" };
    }
    return { ok: false, error: e instanceof Error ? e.message : "網路錯誤" };
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function ProjectTable({
  projects,
  expandedProjectId,
  onToggleExpand,
}: {
  projects: MeetingProjectItem[];
  expandedProjectId: string | null;
  onToggleExpand: (projectId: string) => void;
}) {
  if (projects.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-stone-300 bg-white/60 py-16 text-center text-sm text-stone-500">
        此人目前沒有進行中專案
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-stone-200/90 bg-white">
      <table className="min-w-full text-left text-sm">
        <thead className="border-b border-stone-200 bg-stone-50/90 text-xs font-bold uppercase tracking-wide text-stone-600">
          <tr>
            <th className="w-10 px-2 py-2.5" />
            <th className="px-3 py-2.5">專案</th>
            <th className="px-3 py-2.5">狀態</th>
            <th className="px-3 py-2.5">KOL</th>
            <th className="px-3 py-2.5">客戶</th>
            <th className="px-3 py-2.5">款項</th>
            <th className="px-3 py-2.5">預計付款</th>
            <th className="px-3 py-2.5 text-center">待辦</th>
            <th className="px-3 py-2.5">逾期警示</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {projects.map((p) => {
            const expanded = expandedProjectId === p.專案ID;
            return (
              <Fragment key={p.專案ID}>
                <tr className={p.逾期警示.length > 0 ? "bg-red-50/40 hover:bg-red-50/70" : "hover:bg-amber-50/40"}>
                  <td className="px-2 py-2.5">
                    <button
                      type="button"
                      onClick={() => onToggleExpand(p.專案ID)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-stone-300 bg-stone-50 text-stone-500 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800"
                      title={expanded ? "收合" : "查看任務與備註"}
                    >
                      <svg className={`h-4 w-4 transition-transform ${expanded ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </td>
                  <td className="max-w-[200px] px-3 py-2.5">
                    <p className="font-semibold text-stone-900">{p.專案名稱}</p>
                    <p className="font-mono text-[10px] text-stone-400">{p.專案ID}</p>
                    <p className="text-[10px] text-stone-500">{p.專案類型}</p>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-stone-700">{p.專案狀態}</td>
                  <td className="max-w-[120px] truncate px-3 py-2.5 text-stone-700" title={p.KOL名稱}>
                    {p.KOL名稱}
                  </td>
                  <td className="max-w-[120px] truncate px-3 py-2.5 text-stone-700" title={p.廠商名稱}>
                    {p.廠商名稱}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${financeProgressBadgeClass(p.款項進度)}`}>
                      {p.款項進度}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-stone-700">{p.廠商預計付款日}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-center tabular-nums">
                    {p.未完成任務數 > 0 ? (
                      <span className={p.逾期任務數 > 0 ? "font-bold text-red-700" : "font-medium text-stone-800"}>
                        {p.未完成任務數}
                      </span>
                    ) : (
                      <span className="text-stone-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {p.逾期警示.length === 0 ? (
                      <span className="text-stone-400">—</span>
                    ) : (
                      <ul className="space-y-0.5">
                        {p.逾期警示.map((tag) => (
                          <li key={tag} className="text-xs font-semibold text-red-700">
                            {tag}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
                {expanded ? (
                  <tr>
                    <td colSpan={9} className="bg-stone-50/80 px-3 py-3">
                      <MeetingProjectDetail project={p} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type PersonTab = {
  key: string;
  label: string;
  進行中專案數: number;
  逾期任務數: number;
  逾期專案數: number;
  projects: MeetingProjectItem[];
};

function countOverdueProjectsInList(projects: MeetingProjectItem[]): number {
  return projects.filter((p) => p.逾期警示.length > 0).length;
}

function buildPersonTabs(snapshot: MeetingSnapshot): PersonTab[] {
  const tabs: PersonTab[] = snapshot.personGroups.map((g) => ({
    key: g.person,
    label: g.person,
    進行中專案數: g.進行中專案數,
    逾期任務數: g.逾期任務數,
    逾期專案數: countOverdueProjectsInList(g.projects),
    projects: g.projects,
  }));
  if (snapshot.unassignedProjects.length > 0) {
    tabs.push({
      key: UNASSIGNED_KEY,
      label: UNASSIGNED_KEY,
      進行中專案數: snapshot.unassignedProjects.length,
      逾期任務數: snapshot.unassignedProjects.reduce((s, p) => s + p.逾期任務數, 0),
      逾期專案數: countOverdueProjectsInList(snapshot.unassignedProjects),
      projects: snapshot.unassignedProjects,
    });
  }
  return tabs;
}

function defaultTabKey(tabs: PersonTab[]): string {
  const withOverdue = tabs.find((t) => t.projects.some((p) => p.逾期警示.length > 0));
  return withOverdue?.key ?? tabs[0]?.key ?? "";
}

function countOverdueProjects(snapshot: MeetingSnapshot): number {
  const all = [...snapshot.personGroups.flatMap((g) => g.projects), ...snapshot.unassignedProjects];
  return all.filter((p) => p.逾期警示.length > 0).length;
}

/** 逾期案件置頂；付款日逾期的越早（越久）越往上 */
function sortMeetingProjects(projects: MeetingProjectItem[]): MeetingProjectItem[] {
  const payYmd = (p: MeetingProjectItem) => (p.廠商預計付款日 === "—" ? "" : p.廠商預計付款日);
  const hasPayOverdue = (p: MeetingProjectItem) => p.逾期警示.some((t) => t.includes("預計付款日"));

  return [...projects].sort((a, b) => {
    const aOver = a.逾期警示.length > 0;
    const bOver = b.逾期警示.length > 0;
    if (aOver !== bOver) return aOver ? -1 : 1;
    if (!aOver) return a.專案名稱.localeCompare(b.專案名稱, "zh-Hant");

    const aPay = payYmd(a);
    const bPay = payYmd(b);
    const aPayOver = hasPayOverdue(a);
    const bPayOver = hasPayOverdue(b);
    if (aPayOver && bPayOver && aPay && bPay && aPay !== bPay) {
      return aPay.localeCompare(bPay);
    }
    if (aPayOver !== bPayOver) return aPayOver ? -1 : 1;
    if (aPay && bPay && aPay !== bPay) return aPay.localeCompare(bPay);

    if (a.逾期任務數 !== b.逾期任務數) return b.逾期任務數 - a.逾期任務數;
    return a.專案名稱.localeCompare(b.專案名稱, "zh-Hant");
  });
}

export default function MeetingPage() {
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<MeetingSnapshot | null>(null);
  const [selectedKey, setSelectedKey] = useState("");
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setAuthError(null);
    setLoadError(null);
    const sess = await fetchSessionWithRetry();
    if (!sess.ok || !sess.user) {
      setAuthError("請先登入員工帳號。");
      setLoading(false);
      return;
    }
    if (String(sess.user.role ?? "").trim() === "KOL") {
      setAuthError("此頁面僅供內部晨會使用。");
      setLoading(false);
      return;
    }
    const result = await fetchMeetingSnapshot();
    if (!result.ok) {
      setLoadError(result.error);
      setLoading(false);
      return;
    }
    const tabs = buildPersonTabs(result.snapshot);
    setSnapshot(result.snapshot);
    setSelectedKey(defaultTabKey(tabs));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const personTabs = useMemo(() => (snapshot ? buildPersonTabs(snapshot) : []), [snapshot]);

  const activeTab = useMemo(
    () => personTabs.find((t) => t.key === selectedKey) ?? personTabs[0] ?? null,
    [personTabs, selectedKey]
  );

  const visibleProjects = useMemo(() => {
    if (!activeTab) return [];
    const list = onlyOverdue ? activeTab.projects.filter((p) => p.逾期警示.length > 0) : activeTab.projects;
    return sortMeetingProjects(list);
  }, [activeTab, onlyOverdue]);

  const toggleExpand = useCallback((projectId: string) => {
    setExpandedProjectId((prev) => (prev === projectId ? null : projectId));
  }, []);

  useEffect(() => {
    setExpandedProjectId(null);
  }, [selectedKey]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-stone-500">載入週一晨會視圖…</p>
      </div>
    );
  }

  if (authError) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
        <p className="text-amber-900">{authError}</p>
        <Link href="/" className="mt-4 rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-bold text-slate-900">
          前往登入
        </Link>
      </div>
    );
  }

  if (loadError || !snapshot) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
        <p className="text-red-800">{loadError ?? "載入失敗"}</p>
        <button type="button" onClick={() => void load()} className="mt-4 rounded-xl border border-stone-300 bg-white px-5 py-2.5 text-sm font-semibold">
          重試
        </button>
      </div>
    );
  }

  const overdueProjectCount = countOverdueProjects(snapshot);

  return (
    <>
      <header className="sticky top-0 z-20 border-b border-stone-200/90 bg-[#f4f2ed]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div>
            <Link href="/dashboard" className="text-xs font-semibold text-stone-500 hover:text-stone-800">
              ← 回 Dashboard
            </Link>
            <h1 className="text-xl font-bold tracking-tight text-stone-900 sm:text-2xl">週一晨會 · 專案量能</h1>
            <p className="text-xs text-stone-500">點選人員切換；點 ▶ 展開任務、專案內容與備註</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-700">
              <input type="checkbox" checked={onlyOverdue} onChange={(e) => setOnlyOverdue(e.target.checked)} className="rounded" />
              只看有逾期
            </label>
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-full border border-stone-300 bg-white px-4 py-1.5 text-xs font-semibold text-stone-700 hover:bg-stone-50"
            >
              重新整理
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <section className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-stone-200/80 bg-white px-4 py-3 shadow-sm">
            <p className="text-xs font-medium text-stone-500">進行中專案</p>
            <p className="text-3xl font-bold tabular-nums text-stone-900">{snapshot.inProgressCount}</p>
          </div>
          <div className="rounded-2xl border border-stone-200/80 bg-white px-4 py-3 shadow-sm">
            <p className="text-xs font-medium text-stone-500">主責同仁</p>
            <p className="text-3xl font-bold tabular-nums text-stone-900">{snapshot.personGroups.length}</p>
          </div>
          <div className="rounded-2xl border border-red-200/80 bg-red-50/80 px-4 py-3 shadow-sm">
            <p className="text-xs font-medium text-red-900/80">有逾期專案</p>
            <p className="text-3xl font-bold tabular-nums text-red-900">{overdueProjectCount}</p>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-stone-600">主責人</h2>
          {personTabs.length === 0 ? (
            <p className="text-sm text-stone-500">沒有進行中專案</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {personTabs.map((tab) => {
                const active = tab.key === (activeTab?.key ?? "");
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setSelectedKey(tab.key)}
                    className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${
                      active
                        ? "border-amber-400 bg-amber-100 text-stone-900 shadow-sm ring-2 ring-amber-300/60"
                        : "border-stone-200 bg-white text-stone-700 hover:border-amber-200 hover:bg-amber-50/60"
                    }`}
                  >
                    <span className="max-w-[8rem] truncate sm:max-w-none">{tab.label}</span>
                    <span className="text-xs tabular-nums text-stone-500">{tab.進行中專案數} 案</span>
                    {tab.逾期專案數 > 0 ? (
                      <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold text-white tabular-nums">
                        逾期 {tab.逾期專案數} 案
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {activeTab ? (
          <section className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-lg font-bold text-stone-900">{activeTab.label}</h2>
                <p className="text-xs text-stone-500">
                  進行中 {activeTab.進行中專案數} 案 · 待辦任務{" "}
                  {snapshot.personGroups.find((g: PersonWorkloadGroup) => g.person === activeTab.key)?.未完成任務數 ??
                    activeTab.projects.reduce((s, p) => s + p.未完成任務數, 0)}{" "}
                  件
                  {activeTab.逾期專案數 > 0 ? (
                    <span className="font-semibold text-red-700">
                      {" "}
                      · 逾期 {activeTab.逾期專案數} 案
                      {activeTab.逾期任務數 > 0 ? `（${activeTab.逾期任務數} 件任務）` : ""}
                    </span>
                  ) : null}
                </p>
              </div>
            </div>
            {visibleProjects.length === 0 ? (
              <p className="rounded-xl border border-dashed border-stone-300 bg-white/60 py-12 text-center text-sm text-stone-500">
                {onlyOverdue ? "此人目前沒有逾期項目" : "此人目前沒有進行中專案"}
              </p>
            ) : (
              <ProjectTable
                projects={visibleProjects}
                expandedProjectId={expandedProjectId}
                onToggleExpand={toggleExpand}
              />
            )}
          </section>
        ) : null}

        <p className="text-center text-[11px] text-stone-400">
          資料更新：{new Date(snapshot.generatedAt).toLocaleString("zh-TW")} · 逾期含任務到期、預計付款日已過
        </p>
      </main>
    </>
  );
}
