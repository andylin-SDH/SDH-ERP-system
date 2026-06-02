"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { parseKolAmount } from "@/lib/kol/format";
import { isKolProjectInProgress } from "@/lib/kol/project-lifecycle";
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
  if (status === "待結帳") return "bg-stone-200 text-stone-800";
  if (status === "待分潤") return "bg-amber-100 text-amber-950 ring-1 ring-amber-300/60";
  if (status === "已分潤") return "bg-emerald-100 text-emerald-900 ring-1 ring-emerald-300/50";
  return "bg-stone-100 text-stone-600";
}

type LifecycleTab = "in_progress" | "completed";

export default function KolHomePage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [partnerName, setPartnerName] = useState<string>("");
  const [partnerId, setPartnerId] = useState<string>("");
  const [projects, setProjects] = useState<KolPortalProject[]>([]);
  const [lifecycleTab, setLifecycleTab] = useState<LifecycleTab>("in_progress");

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
    setProjects(Array.isArray(data.projects) ? data.projects : []);
    setLoading(false);
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
    for (const p of inProgressProjects) {
      kolFeeSum += parseKolAmount(p.KOL費用未稅);
      if (p.結帳狀態 === "待結帳") pendingSettlement += 1;
    }
    return {
      inProgressCount: inProgressProjects.length,
      kolFeeSum,
      pendingSettlement,
    };
  }, [inProgressProjects]);

  const visibleProjects = lifecycleTab === "in_progress" ? inProgressProjects : completedProjects;

  async function handleLogout() {
    await fetch("/api/auth/session", { method: "DELETE", credentials: "include" });
    window.location.href = "/";
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-8 sm:px-6">
      <header className="mb-8 flex flex-col gap-4 border-b border-amber-200/80 pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Image src="/logo.png" alt="SDH" width={200} height={48} className="h-10 w-auto object-contain" />
          <div>
            <h1 className="text-lg font-bold tracking-tight text-stone-900">我的專案</h1>
            <p className="text-xs text-stone-500">只讀檢視 · 結帳狀態依財務入帳自動更新</p>
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
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {error}
        </div>
      )}

      {!loading && !error && (
        <>
          <p className="mb-4 text-sm text-stone-600">
            <span className="font-semibold text-stone-800">{partnerName || "—"}</span>
            {partnerId ? <span className="ml-2 text-stone-500">（{partnerId}）</span> : null}
          </p>

          <div className="mb-6 grid gap-3 sm:grid-cols-3">
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
              <p className="text-xs font-medium text-stone-500">進行中 · 待結帳</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-amber-900">{summary.pendingSettlement}</p>
            </div>
          </div>

          <p className="mb-4 text-xs leading-relaxed text-stone-500">
            <strong className="text-stone-700">結帳狀態</strong>：財務於發票／依專案財務填寫「廠商付款日（入帳）」後，會由「待結帳」變為「待分潤」或「已分潤」。請按「重新整理」查看最新狀態。
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
                    <th className="whitespace-nowrap px-3 py-3 font-semibold">專案狀態</th>
                    <th className="whitespace-nowrap px-3 py-3 font-semibold">結帳狀態</th>
                    <th className="whitespace-nowrap px-3 py-3 font-semibold">KOL費用未稅</th>
                    <th className="whitespace-nowrap px-3 py-3 font-semibold">專案總金額未稅</th>
                    <th className="whitespace-nowrap px-3 py-3 font-semibold">廠商入帳日</th>
                    <th className="whitespace-nowrap px-3 py-3 font-semibold">發票含稅合計</th>
                    <th className="whitespace-nowrap px-3 py-3 font-semibold">發票筆數</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200">
                  {visibleProjects.map((p) => (
                    <tr key={p.專案ID} className="bg-amber-50/30 hover:bg-amber-50/60">
                      <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-stone-800">{p.專案ID}</td>
                      <td className="max-w-[220px] px-3 py-3 text-stone-800">{p.專案名稱}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-stone-600">{p.專案狀態}</td>
                      <td className="whitespace-nowrap px-3 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${settlementBadgeClass(p.結帳狀態)}`}
                        >
                          {p.結帳狀態}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 tabular-nums text-stone-900">{p.KOL費用未稅}</td>
                      <td className="whitespace-nowrap px-3 py-3 tabular-nums text-stone-700">{p.專案總金額未稅}</td>
                      <td className="whitespace-nowrap px-3 py-3 tabular-nums text-stone-700">{p.廠商付款日期}</td>
                      <td className="whitespace-nowrap px-3 py-3 tabular-nums text-stone-900">{p.發票已開含稅合計}</td>
                      <td className="whitespace-nowrap px-3 py-3 tabular-nums text-stone-600">{p.發票筆數}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
