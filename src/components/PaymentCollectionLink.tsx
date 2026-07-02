"use client";

import { useCallback, useEffect, useState } from "react";

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
};

export function PaymentCollectionLink({ 專案ID, hasInvoices, compact }: Props) {
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
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
        submissions?: unknown[];
      };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "讀取失敗");
        return;
      }
      setUrl(data.link?.url ?? null);
      setSubmissionCount(Array.isArray(data.submissions) ? data.submissions.length : 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "讀取失敗");
    } finally {
      setLoading(false);
    }
  }, [專案ID, hasInvoices]);

  useEffect(() => {
    void load();
  }, [load]);

  async function generate() {
    setGenerating(true);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch("/api/payment-links", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 專案ID }),
      });
      const data = (await safeResJson(res)) as { ok?: boolean; error?: string; link?: { url?: string } };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "產生失敗");
        return;
      }
      setUrl(data.link?.url ?? null);
      setNotice("收款連結已就緒，可複製傳給匯款方");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "產生失敗");
    } finally {
      setGenerating(false);
    }
  }

  async function copyUrl() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setNotice("已複製連結");
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
        <h4 className="text-sm font-bold text-sky-900">收款表單</h4>
        {submissionCount > 0 && (
          <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-sky-800 ring-1 ring-sky-200">
            已收到 {submissionCount} 筆申報
          </span>
        )}
      </div>
      <p className="mb-3 text-xs leading-relaxed text-stone-600">
        產生連結後傳給匯款方填寫；對方會看到本專案發票明細與 SDH 收款帳戶，提交後供日後自動對帳。
      </p>
      {loading && <p className="text-xs text-stone-500">載入中…</p>}
      {error && <p className="mb-2 text-xs text-red-700">{error}</p>}
      {notice && <p className="mb-2 text-xs text-emerald-800">{notice}</p>}
      {!loading && (
        <div className="flex flex-wrap items-center gap-2">
          {!url ? (
            <button
              type="button"
              disabled={generating}
              onClick={() => void generate()}
              className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-500 disabled:opacity-60"
            >
              {generating ? "產生中…" : "產生收款連結"}
            </button>
          ) : (
            <>
              <input
                readOnly
                value={url}
                className="min-w-0 flex-1 rounded-lg border border-sky-200 bg-white px-2 py-1.5 text-xs font-mono text-stone-700"
              />
              <button
                type="button"
                onClick={() => void copyUrl()}
                className="rounded-lg border border-sky-300 bg-white px-3 py-1.5 text-xs font-semibold text-sky-900 hover:bg-sky-50"
              >
                複製
              </button>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-sky-300 bg-white px-3 py-1.5 text-xs font-semibold text-sky-900 hover:bg-sky-50"
              >
                預覽
              </a>
            </>
          )}
        </div>
      )}
    </div>
  );
}
