"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
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

function progressBadgeClass(short: string): string {
  if (short === "待結帳") return "bg-stone-200 text-stone-800";
  if (short === "待分潤") return "bg-amber-100 text-amber-950 ring-1 ring-amber-300/60";
  if (short === "已分潤") return "bg-emerald-100 text-emerald-900 ring-1 ring-emerald-300/50";
  return "bg-stone-100 text-stone-600";
}

export default function KolHomePage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [partnerName, setPartnerName] = useState<string>("");
  const [partnerId, setPartnerId] = useState<string>("");
  const [projects, setProjects] = useState<KolPortalProject[]>([]);

  const load = useCallback(async () => {
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
      setError(data.error ?? "此帳號不是 KOL 入口專用，請使用員工登入。");
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

  async function handleLogout() {
    await fetch("/api/auth/session", { method: "DELETE", credentials: "include" });
    window.location.href = "/";
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-4 py-8 sm:px-6">
      <header className="mb-8 flex flex-col gap-4 border-b border-amber-200/80 pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Image src="/logo.png" alt="SDH" width={200} height={48} className="h-10 w-auto object-contain" />
          <div>
            <h1 className="text-lg font-bold tracking-tight text-stone-900">KOL 專案總覽</h1>
            <p className="text-xs text-stone-500">僅供檢視，無法修改資料</p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="self-start rounded-xl border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-600 shadow-sm hover:bg-stone-50"
        >
          登出
        </button>
      </header>

      {loading && <p className="text-stone-500">載入中…</p>}
      {error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {error}
        </div>
      )}

      {!loading && !error && (
        <>
          <p className="mb-6 text-sm text-stone-600">
            <span className="font-semibold text-stone-800">{partnerName || "—"}</span>
            {partnerId ? (
              <span className="ml-2 text-stone-500">（{partnerId}）</span>
            ) : null}
          </p>
          <p className="mb-4 text-xs leading-relaxed text-stone-500">
            以下為與您名稱相符的大總表專案。「款項進度」依財務填寫之廠商付款／員工分潤日期顯示；「發票已開未稅合計」為發票清冊中該專案之加總，實際請款請再與窗口確認。
          </p>

          {projects.length === 0 ? (
            <p className="rounded-xl border border-stone-200 bg-white/80 px-4 py-10 text-center text-stone-500">
              目前沒有與您對應的專案列，或尚未在大總表填入與您相同的 KOL 名稱。
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-stone-200/90 bg-white/90 shadow-sm ring-1 ring-amber-100/50">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-amber-100/90 text-amber-950">
                  <tr>
                    <th className="whitespace-nowrap px-3 py-3 font-semibold">專案ID</th>
                    <th className="min-w-[140px] px-3 py-3 font-semibold">專案名稱</th>
                    <th className="whitespace-nowrap px-3 py-3 font-semibold">狀態</th>
                    <th className="whitespace-nowrap px-3 py-3 font-semibold">款項進度</th>
                    <th className="whitespace-nowrap px-3 py-3 font-semibold">廠商付款日</th>
                    <th className="whitespace-nowrap px-3 py-3 font-semibold">員工分潤日</th>
                    <th className="whitespace-nowrap px-3 py-3 font-semibold">發票已開未稅</th>
                    <th className="whitespace-nowrap px-3 py-3 font-semibold">發票筆數</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200">
                  {projects.map((p) => (
                    <tr key={p.專案ID} className="bg-amber-50/30 hover:bg-amber-50/60">
                      <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-stone-800">{p.專案ID}</td>
                      <td className="max-w-[220px] px-3 py-3 text-stone-800">{p.專案名稱}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-stone-600">{p.專案狀態}</td>
                      <td className="whitespace-nowrap px-3 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${progressBadgeClass(p.款項進度)}`}
                        >
                          {p.款項進度}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 tabular-nums text-stone-700">{p.廠商付款日期}</td>
                      <td className="whitespace-nowrap px-3 py-3 tabular-nums text-stone-700">{p.員工分潤日期}</td>
                      <td className="whitespace-nowrap px-3 py-3 tabular-nums text-stone-900">{p.發票已開未稅合計}</td>
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
