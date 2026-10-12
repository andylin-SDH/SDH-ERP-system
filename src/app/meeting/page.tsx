"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchSessionWithRetry } from "@/components/ErpLoginPanel";
import { MeetingProjectDetail } from "@/components/meeting/MeetingProjectDetail";
import { financeProgressBadgeClass } from "@/lib/meeting/ui";
import type { MeetingProjectItem, MeetingSnapshot, MeetingTaskItem } from "@/lib/meeting/types";

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

function sortProjectTasks(tasks: MeetingTaskItem[]): MeetingTaskItem[] {
  return [...tasks].sort((a, b) => {
    const aDue = a.到期日 === "—" ? "" : a.到期日;
    const bDue = b.到期日 === "—" ? "" : b.到期日;
    if (aDue && bDue && aDue !== bDue) return aDue.localeCompare(bDue);
    if (aDue !== bDue) return aDue ? -1 : 1;
    return a.任務.localeCompare(b.任務, "zh-Hant");
  });
}

function ProjectBoard({
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
        沒有符合的專案
      </p>
    );
  }
  return (
    <div className="space-y-4">
      {projects.map((p) => {
        const expanded = expandedProjectId === p.專案ID;
        const tasks = sortProjectTasks(p.待辦任務);
        return (
          <article key={p.專案ID} className="overflow-hidden rounded-2xl border border-stone-200/90 bg-white shadow-sm">
            <header className="flex flex-wrap items-start justify-between gap-3 bg-stone-50/80 px-4 py-3">
              <div className="min-w-0">
                <h3 className="text-base font-bold text-stone-900">{p.專案名稱}</h3>
                <p className="mt-0.5 font-mono text-[10px] text-stone-400">
                  {p.專案ID}
                  {p.專案類型 ? ` · ${p.專案類型}` : ""}
                </p>
                <p className="mt-1 text-xs text-stone-600">
                  主責 {p.主責人 || "—"}
                  {p.KOL名稱 && p.KOL名稱 !== "—" ? ` · KOL ${p.KOL名稱}` : ""}
                  {p.廠商名稱 && p.廠商名稱 !== "—" ? ` · 客戶 ${p.廠商名稱}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-stone-700 ring-1 ring-stone-200">
                  {p.專案狀態}
                </span>
                <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${financeProgressBadgeClass(p.款項進度)}`}>
                  {p.款項進度}
                </span>
                <span className="text-xs tabular-nums text-stone-600">開案 {p.開案日期}</span>
                <span className="text-xs tabular-nums text-stone-600">預計付款 {p.廠商預計付款日}</span>
              </div>
            </header>
            {tasks.length === 0 ? (
              <p className="px-4 py-4 text-sm text-stone-500">這個專案沒有未完成任務</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-y border-stone-100 bg-white text-xs font-bold text-stone-500">
                    <tr>
                      <th className="px-4 py-2">到期日</th>
                      <th className="px-4 py-2">任務</th>
                      <th className="px-4 py-2">負責人</th>
                      <th className="px-4 py-2">類型</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {tasks.map((t) => (
                      <tr key={t.任務ID || `${p.專案ID}-${t.任務}-${t.到期日}`}>
                        <td className="whitespace-nowrap px-4 py-2.5 tabular-nums font-medium text-stone-800">{t.到期日}</td>
                        <td className="px-4 py-2.5 font-medium text-stone-900">{t.任務}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-stone-700">{t.任務負責人}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-stone-600">{t.任務類型}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex items-center justify-between border-t border-stone-100 px-4 py-2">
              <p className="text-xs text-stone-500">
                待辦 {p.未完成任務數} 件
              </p>
              <button
                type="button"
                onClick={() => onToggleExpand(p.專案ID)}
                className="text-xs font-semibold text-amber-800 hover:text-amber-600"
              >
                {expanded ? "收合內容" : "專案內容與備註"}
              </button>
            </div>
            {expanded ? (
              <div className="border-t border-stone-100 bg-stone-50/80 px-3 py-3">
                <MeetingProjectDetail project={p} showTasks={false} />
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

type PersonTab = {
  key: string;
  label: string;
  進行中專案數: number;
  未完成任務數: number;
  projects: MeetingProjectItem[];
};

function buildPersonTabs(snapshot: MeetingSnapshot): PersonTab[] {
  const tabs: PersonTab[] = snapshot.personGroups.map((g) => ({
    key: g.person,
    label: g.person,
    進行中專案數: g.進行中專案數,
    未完成任務數: g.projects.reduce((s, p) => s + p.未完成任務數, 0),
    projects: g.projects,
  }));
  tabs.sort((a, b) => b.進行中專案數 - a.進行中專案數 || a.label.localeCompare(b.label, "zh-Hant"));
  if (snapshot.unassignedProjects.length > 0) {
    tabs.push({
      key: UNASSIGNED_KEY,
      label: UNASSIGNED_KEY,
      進行中專案數: snapshot.unassignedProjects.length,
      未完成任務數: snapshot.unassignedProjects.reduce((s, p) => s + p.未完成任務數, 0),
      projects: snapshot.unassignedProjects,
    });
  }
  return tabs;
}

const PROJECT_SORT_OPTIONS = [
  { id: "name", label: "專案名稱" },
  { id: "openDesc", label: "開案日期（新到舊）" },
  { id: "openAsc", label: "開案日期（舊到新）" },
  { id: "payAsc", label: "預計付款日（近到遠）" },
  { id: "confirmDesc", label: "狀態確認（新到舊）" },
  { id: "tasksDesc", label: "待辦數量（多到少）" },
] as const;

type MeetingProjectSortMode = (typeof PROJECT_SORT_OPTIONS)[number]["id"];

function ymdOrEmpty(value: string): string {
  return value === "—" ? "" : value;
}

/** 空日期一律排最後 */
function compareYmd(a: string, b: string, direction: "asc" | "desc"): number {
  const left = ymdOrEmpty(a);
  const right = ymdOrEmpty(b);
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return direction === "asc" ? left.localeCompare(right) : right.localeCompare(left);
}

function sortMeetingProjects(projects: MeetingProjectItem[], mode: MeetingProjectSortMode): MeetingProjectItem[] {
  return [...projects].sort((a, b) => {
    let diff = 0;
    if (mode === "name") diff = a.專案名稱.localeCompare(b.專案名稱, "zh-Hant");
    else if (mode === "openDesc") diff = compareYmd(a.開案日期, b.開案日期, "desc");
    else if (mode === "openAsc") diff = compareYmd(a.開案日期, b.開案日期, "asc");
    else if (mode === "payAsc") diff = compareYmd(a.廠商預計付款日, b.廠商預計付款日, "asc");
    else if (mode === "confirmDesc") diff = compareYmd(a.狀態確認日期, b.狀態確認日期, "desc");
    else diff = b.未完成任務數 - a.未完成任務數;
    if (diff !== 0) return diff;
    return a.專案名稱.localeCompare(b.專案名稱, "zh-Hant");
  });
}

export default function MeetingPage() {
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<MeetingSnapshot | null>(null);
  const [selectedKey, setSelectedKey] = useState("");
  const [projectSortMode, setProjectSortMode] = useState<MeetingProjectSortMode>("name");
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
    setSelectedKey(tabs[0]?.key ?? "");
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
    return sortMeetingProjects(activeTab.projects, projectSortMode);
  }, [activeTab, projectSortMode]);

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

  const openTaskCount = [...snapshot.personGroups.flatMap((g) => g.projects), ...snapshot.unassignedProjects].reduce(
    (sum, project) => sum + project.未完成任務數,
    0
  );
  const sortLabel = PROJECT_SORT_OPTIONS.find((option) => option.id === projectSortMode)?.label ?? "專案名稱";

  return (
    <>
      <header className="sticky top-0 z-20 border-b border-stone-200/90 bg-[#f4f2ed]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div>
            <Link href="/dashboard" className="text-xs font-semibold text-stone-500 hover:text-stone-800">
              ← 回 Dashboard
            </Link>
            <h1 className="text-xl font-bold tracking-tight text-stone-900 sm:text-2xl">週一晨會 · 專案量能</h1>
            <p className="text-xs text-stone-500">先選主責人，再用排序瀏覽他的進行中專案。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold text-stone-700">
              排序
              <select
                value={projectSortMode}
                onChange={(e) => setProjectSortMode(e.target.value as MeetingProjectSortMode)}
                className="bg-transparent text-xs font-semibold text-stone-900 focus:outline-none"
                aria-label="專案排序"
              >
                {PROJECT_SORT_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
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
          <div className="rounded-2xl border border-stone-200/80 bg-white px-4 py-3 shadow-sm">
            <p className="text-xs font-medium text-stone-500">待辦任務</p>
            <p className="text-3xl font-bold tabular-nums text-stone-900">{openTaskCount}</p>
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
                  進行中 {activeTab.進行中專案數} 案 · 待辦任務 {activeTab.未完成任務數} 件
                </p>
              </div>
            </div>
            {visibleProjects.length === 0 ? (
              <p className="rounded-xl border border-dashed border-stone-300 bg-white/60 py-12 text-center text-sm text-stone-500">
                此人目前沒有進行中專案
              </p>
            ) : (
              <ProjectBoard
                projects={visibleProjects}
                expandedProjectId={expandedProjectId}
                onToggleExpand={toggleExpand}
              />
            )}
          </section>
        ) : null}

        <p className="text-center text-[11px] text-stone-400">
          資料更新：{new Date(snapshot.generatedAt).toLocaleString("zh-TW")} · 目前排序：{sortLabel}
        </p>
      </main>
    </>
  );
}
