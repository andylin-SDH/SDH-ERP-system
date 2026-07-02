"use client";

import { useCallback, useEffect, useState } from "react";
import type { PaymentSubmissionRow } from "@/lib/payment-collection/types";
import { formatTaipeiDateTime } from "@/lib/taiwan-date";

async function safeResJson(r: Response): Promise<Record<string, unknown>> {
  const text = await r.text();
  if (!text.trim()) return {};
  try {
    return (JSON.parse(text) as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

type Props = {
  專案ID: string;
  hasInvoices: boolean;
  compact?: boolean;
  showSubmissions?: boolean;
};

export function PaymentCollectionLink({ 專案ID, hasInvoices, compact, showSubmissions }: Props) {
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<PaymentSubmissionRow[]>([]);
  const [submissionCount, setSubmissionCount] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!專案ID || !hasInvoices) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/payment-links?專案ID=${encodeURIComponent(專案ID)}`, {
        credentials: "include",
        cache: "no-store",
      });
      const data = (await safeResJson(res)) as {
        ok?: boolean;
        error?: string;
        link?: { url?: string } | null;
        submissions?: PaymentSubmissionRow[];
      };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "讀取失敗");
        return;
      }
      setUrl(data.link?.url ?? null);
      const list = Array.isArray(data.submissions) ? data.submissions : [];
      setSubmissions(list);
      setSubmissionCount(list.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : "讀取失敗");
    } finally {
      setLoading(false);
    }
  }, [專案ID, hasInvoices]);

  useEffect(() => {
    void load();
  }, [load]);

  async function postLink(regenerate: boolean) {
    if (regenerate) {
      const ok = window.confirm(
        "將產生新的收款連結，舊連結（含已給客戶的 preview 網址）將無法再使用。確定要重新產生嗎？"
      );
      if (!ok) return;
      setRegenerating(true);
    } else {
      setGenerating(true);
    }
    setNotice(null);
    setError(null);
    try {
      const res = await fetch("/api/payment-links", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 專案ID, regenerate }),
      });
      const data = (await safeResJson(res)) as { ok?: boolean; error?: string; link?: { url?: string } };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "產生失敗");
        return;
      }
      setUrl(data.link?.url ?? null);
      setNotice(regenerate ? "已重新產生連結，請複製新連結給客戶" : "收款連結已就緒，請複製給客戶");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "產生失敗");
    } finally {
      setGenerating(false);
      setRegenerating(false);
    }
  }

  async function copyUrl() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setNotice("已複製給客戶用的正式連結");
    } catch {
      setNotice("請手動選取連結複製");
    }
  }

  if (!hasInvoices) {
    return (
      <p className="text-xs text-stone-500">
        請先在發票清冊將發票連結至此專案，即可產生收款表單連結。
      </p>
    );
  }

  const boxClass = compact
    ? "rounded-lg border border-sky-200/80 bg-sky-50/40 p-3"
    : "rounded-xl border border-sky-200/80 bg-sky-50/40 p-4";

  return (
    <div className={boxClass}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-bold text-sky-900">收款表單 · 給客戶填匯款資訊</h4>
        {submissionCount > 0 && (
          <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-sky-800 ring-1 ring-sky-200">
            已收到 {submissionCount} 筆申報
          </span>
        )}
      </div>
      <p className="mb-2 text-xs leading-relaxed text-stone-600">
        連結固定使用 <strong className="text-stone-800">erp.sdh-corp.com</strong>，客戶<strong>不需登入</strong>。
        若曾給錯 Vercel 預覽網址，通常只要按「複製給客戶」取得正式連結即可（token 不變）。
      </p>
      {loading && <p className="text-xs text-stone-500">載入中…</p>}
      {error && <p className="mb-2 text-xs text-red-700">{error}</p>}
      {notice && <p className="mb-2 text-xs text-emerald-800">{notice}</p>}
      {!loading && (
        <div className="space-y-2">
          {!url ? (
            <button
              type="button"
              disabled={generating}
              onClick={() => void postLink(false)}
              className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-500 disabled:opacity-60"
            >
              {generating ? "產生中…" : "產生收款連結"}
            </button>
          ) : (
            <>
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-stone-500">
                給客戶的連結（正式網域）
              </label>
              <input
                readOnly
                value={url}
                className="w-full rounded-lg border border-sky-200 bg-white px-2 py-2 text-xs font-mono text-stone-700"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void copyUrl()}
                  className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-500"
                >
                  複製給客戶
                </button>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg border border-sky-300 bg-white px-3 py-1.5 text-xs font-semibold text-sky-900 hover:bg-sky-50"
                >
                  預覽
                </a>
                <button
                  type="button"
                  disabled={regenerating}
                  onClick={() => void postLink(true)}
                  className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-950 hover:bg-amber-100 disabled:opacity-60"
                >
                  {regenerating ? "處理中…" : "重新產生連結"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {showSubmissions && submissions.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-sky-100 bg-white/80">
          <table className="min-w-full text-xs">
            <thead className="bg-sky-50/80 text-stone-600">
              <tr>
                <th className="px-2 py-2 text-left font-semibold">提交時間</th>
                <th className="px-2 py-2 text-left font-semibold">匯款單位</th>
                <th className="px-2 py-2 text-left font-semibold">匯款日</th>
                <th className="px-2 py-2 text-right font-semibold">金額</th>
                <th className="px-2 py-2 text-left font-semibold">末五碼</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {submissions.map((s) => (
                <tr key={s.id}>
                  <td className="whitespace-nowrap px-2 py-2 text-stone-600">
                    {formatTaipeiDateTime(s.submitted_at)}
                  </td>
                  <td className="px-2 py-2 text-stone-800">{s.匯款單位}</td>
                  <td className="whitespace-nowrap px-2 py-2">{s.匯款日期 || "—"}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums font-semibold">
                    {s.匯款金額 != null ? Number(s.匯款金額).toLocaleString("zh-TW") : "—"}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 font-mono">{s.匯款末五碼}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
