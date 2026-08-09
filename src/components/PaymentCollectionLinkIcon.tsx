"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PaymentSubmissionRow } from "@/lib/payment-collection/types";

async function safeResJson(r: Response): Promise<Record<string, unknown>> {
  const text = await r.text();
  if (!text.trim()) return {};
  try {
    return (JSON.parse(text) as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

type LinkPreview = {
  url: string | null;
  submissions: PaymentSubmissionRow[];
};

/** 同一專案多列共用，避免發票清冊重複請求 */
const previewCache = new Map<string, LinkPreview>();
const inflight = new Map<string, Promise<LinkPreview | null>>();

async function fetchPaymentLinkPreview(pid: string): Promise<LinkPreview | null> {
  const cached = previewCache.get(pid);
  if (cached) return cached;

  const pending = inflight.get(pid);
  if (pending) return pending;

  const task = (async () => {
    try {
      const res = await fetch(`/api/payment-links?專案ID=${encodeURIComponent(pid)}`, {
        credentials: "include",
        cache: "no-store",
      });
      const data = (await safeResJson(res)) as {
        ok?: boolean;
        link?: { url?: string } | null;
        submissions?: PaymentSubmissionRow[];
      };
      if (!res.ok || !data.ok) return null;
      const preview: LinkPreview = {
        url: data.link?.url ?? null,
        submissions: Array.isArray(data.submissions) ? data.submissions : [],
      };
      previewCache.set(pid, preview);
      return preview;
    } catch {
      return null;
    } finally {
      inflight.delete(pid);
    }
  })();

  inflight.set(pid, task);
  return task;
}

function applyPreview(
  preview: LinkPreview | null,
  setUrl: (v: string | null) => void,
  setSubmissions: (v: PaymentSubmissionRow[]) => void
) {
  if (!preview) return;
  setUrl(preview.url);
  setSubmissions(preview.submissions);
}

type Props = {
  專案ID: string;
  /** 點「查看申報」時（例如切換至收款申報分頁） */
  onViewSubmissions?: () => void;
};

export function PaymentCollectionLinkIcon({ 專案ID, onViewSubmissions }: Props) {
  const pid = String(專案ID ?? "").trim();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<PaymentSubmissionRow[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const submissionCount = submissions.length;
  const latestCodes = (() => {
    const seen = new Set<string>();
    const codes: string[] = [];
    for (const s of submissions) {
      const code = String(s.匯款末五碼 ?? "").trim();
      if (!/^\d{5}$/.test(code) || seen.has(code)) continue;
      seen.add(code);
      codes.push(code);
      if (codes.length >= 3) break;
    }
    return codes;
  })();

  const load = useCallback(async (force = false) => {
    if (!pid) return;
    if (force) previewCache.delete(pid);
    setLoading(true);
    setError(null);
    try {
      const preview = await fetchPaymentLinkPreview(pid);
      if (!preview) {
        setError("讀取失敗");
        return;
      }
      applyPreview(preview, setUrl, setSubmissions);
    } catch (e) {
      setError(e instanceof Error ? e.message : "讀取失敗");
    } finally {
      setLoading(false);
    }
  }, [pid]);

  /** 進入清冊即預載申報筆數（供徽章顯示） */
  useEffect(() => {
    if (!pid) return;
    let cancelled = false;
    void fetchPaymentLinkPreview(pid).then((preview) => {
      if (cancelled || !preview) return;
      applyPreview(preview, setUrl, setSubmissions);
    });
    return () => {
      cancelled = true;
    };
  }, [pid]);

  useEffect(() => {
    if (!open || !pid) return;
    void load(true);
  }, [open, pid, load]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  async function postLink(regenerate: boolean) {
    if (regenerate) {
      const ok = window.confirm("將產生新連結，舊連結將失效。確定？");
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
        body: JSON.stringify({ 專案ID: pid, regenerate }),
      });
      const data = (await safeResJson(res)) as { ok?: boolean; error?: string; link?: { url?: string } };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "產生失敗");
        return;
      }
      previewCache.delete(pid);
      setUrl(data.link?.url ?? null);
      setNotice(regenerate ? "已重新產生，請複製新連結" : "連結已就緒");
      await load(true);
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
      setNotice("已複製正式連結");
    } catch {
      setNotice("請手動複製");
    }
  }

  if (!pid) {
    return (
      <button
        type="button"
        disabled
        title="請先設定對應專案"
        className="rounded-lg border border-stone-200 p-1.5 text-stone-300"
        aria-label="收款連結（需先設定專案）"
      >
        <LinkIcon className="h-4 w-4" />
      </button>
    );
  }

  const badgeTitle =
    submissionCount > 0
      ? `已有 ${submissionCount} 筆匯款申報${latestCodes.length ? `，末五碼 ${latestCodes.join("、")}` : ""}；點開查看或複製連結`
      : "收款表單連結";

  return (
    <div ref={wrapRef} className="relative inline-flex items-center gap-1.5">
      <button
        type="button"
        title={badgeTitle}
        onClick={() => {
          setOpen((v) => !v);
          setNotice(null);
        }}
        className={`relative rounded-lg border p-1.5 transition ${
          open
            ? "border-sky-400 bg-sky-50 text-sky-800"
            : submissionCount > 0
              ? "border-emerald-300 bg-emerald-50/80 text-sky-700 hover:border-emerald-400"
              : "border-sky-200 bg-white text-sky-700 hover:border-sky-300 hover:bg-sky-50"
        }`}
        aria-label={badgeTitle}
      >
        <LinkIcon className="h-4 w-4" />
        {submissionCount > 0 && (
          <span
            className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-emerald-600 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white"
            aria-hidden
          >
            {submissionCount > 99 ? "99+" : submissionCount}
          </span>
        )}
      </button>
      {latestCodes.length > 0 ? (
        <button
          type="button"
          title={badgeTitle}
          onClick={() => {
            setOpen((v) => !v);
            setNotice(null);
          }}
          className="max-w-[7.5rem] rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-left transition hover:bg-emerald-100"
        >
          <span className="block text-[9px] font-semibold leading-none text-emerald-800/80">末五碼</span>
          <span className="block truncate font-mono text-[11px] font-bold tabular-nums tracking-wide text-emerald-950">
            {latestCodes.join(" · ")}
            {submissionCount > latestCodes.length ? "…" : ""}
          </span>
        </button>
      ) : null}
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-80 rounded-xl border border-stone-200 bg-white p-3 text-left shadow-lg ring-1 ring-stone-100">
          <p className="mb-2 text-xs font-bold text-sky-900">收款表單 · {pid}</p>
          {loading && <p className="text-xs text-stone-500">載入中…</p>}
          {error && <p className="mb-2 text-xs text-red-700">{error}</p>}
          {notice && <p className="mb-2 text-xs text-emerald-700">{notice}</p>}
          {!loading && (
            <div className="space-y-2">
              {!url ? (
                <button
                  type="button"
                  disabled={generating}
                  onClick={() => void postLink(false)}
                  className="w-full rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-500 disabled:opacity-60"
                >
                  {generating ? "產生中…" : "產生收款連結"}
                </button>
              ) : (
                <>
                  <p className="text-[10px] text-stone-500">給客戶（erp.sdh-corp.com，免登入）</p>
                  <input
                    readOnly
                    value={url}
                    className="w-full rounded border border-stone-200 px-2 py-1 text-[10px] font-mono text-stone-700"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => void copyUrl()}
                      className="rounded bg-sky-600 px-2 py-1 text-xs font-bold text-white hover:bg-sky-500"
                    >
                      複製給客戶
                    </button>
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded border border-sky-200 px-2 py-1 text-xs font-semibold text-sky-900 hover:bg-sky-50"
                    >
                      預覽
                    </a>
                    <button
                      type="button"
                      disabled={regenerating}
                      onClick={() => void postLink(true)}
                      className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-950 hover:bg-amber-100 disabled:opacity-60"
                    >
                      {regenerating ? "…" : "重新產生"}
                    </button>
                  </div>
                </>
              )}
              {submissionCount > 0 ? (
                <div className="rounded-lg border border-emerald-100 bg-emerald-50/50 p-2">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold text-emerald-950">
                      客戶已填申報 <span className="tabular-nums">{submissionCount}</span> 筆
                    </p>
                    {onViewSubmissions ? (
                      <button
                        type="button"
                        onClick={() => {
                          setOpen(false);
                          onViewSubmissions();
                        }}
                        className="text-[11px] font-semibold text-sky-700 underline"
                      >
                        全部申報
                      </button>
                    ) : null}
                  </div>
                  <ul className="max-h-40 space-y-1.5 overflow-y-auto">
                    {submissions.slice(0, 8).map((s) => (
                      <li
                        key={s.id}
                        className="rounded-md border border-white/80 bg-white px-2 py-1.5 text-[11px] text-stone-700 shadow-sm"
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-mono text-sm font-bold tabular-nums tracking-wider text-emerald-900">
                            {s.匯款末五碼 || "—"}
                          </span>
                          <span className="shrink-0 tabular-nums text-stone-500">{s.匯款日期 || "—"}</span>
                        </div>
                        <p className="mt-0.5 truncate text-stone-600" title={s.匯款單位}>
                          {s.匯款單位 || "（未填匯款單位）"}
                          {s.匯款金額 ? ` · ${s.匯款金額}` : ""}
                        </p>
                      </li>
                    ))}
                  </ul>
                  {submissionCount > 8 ? (
                    <p className="mt-1 text-[10px] text-stone-500">僅顯示最近 8 筆，完整清單請至「收款申報」</p>
                  ) : null}
                </div>
              ) : (
                <p className="text-[11px] text-stone-500">尚無客戶填寫末五碼／匯款申報</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LinkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}
