"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ErpLoginPanel, fetchSessionWithRetry } from "@/components/ErpLoginPanel";
import { parseBankCsv, type ParsedBankCsv } from "@/lib/reconciliation/csv";
import type {
  BankImportRow,
  ReconciliationDashboardRun,
  ReconciliationDashboardTransaction,
} from "@/lib/reconciliation/types";

type FilterKey = "pending" | "matched" | "unmatched" | "ignored" | "all";

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function money(value: number, currency = "TWD"): string {
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: currency || "TWD",
    maximumFractionDigits: 2,
  }).format(value);
}

function statusLabel(status: ReconciliationDashboardTransaction["status"]): string {
  return {
    unmatched: "未匹配",
    suggested: "待確認",
    matched: "已入帳",
    ignored: "已忽略",
  }[status];
}

function statusClass(status: ReconciliationDashboardTransaction["status"]): string {
  return {
    unmatched: "border-stone-200 bg-stone-100 text-stone-700",
    suggested: "border-amber-200 bg-amber-50 text-amber-900",
    matched: "border-emerald-200 bg-emerald-50 text-emerald-800",
    ignored: "border-slate-200 bg-slate-100 text-slate-600",
  }[status];
}

function scoreClass(score: number): string {
  if (score >= 90) return "bg-emerald-100 text-emerald-800";
  if (score >= 75) return "bg-amber-100 text-amber-900";
  return "bg-stone-100 text-stone-700";
}

function reasonDisplay(reason: string): { label: string; symbol: string; className: string } {
  const approximateClass = "border-amber-300 bg-amber-100 text-amber-950";
  const exactClass = "border-emerald-300 bg-emerald-100 text-emerald-900";

  const shortfall = reason.match(/少 ([\d,.]+) 元/);
  if (shortfall) {
    return {
      label: `金額少 ${shortfall[1]} 元，在容許範圍`,
      symbol: "≈",
      className: approximateClass,
    };
  }
  const dateDistance = reason.match(/匯款日期相差 (\d+) 天/);
  if (dateDistance) {
    return {
      label: `日期相差 ${dateDistance[1]} 天`,
      symbol: "≈",
      className: approximateClass,
    };
  }
  if (reason.includes("名稱相近")) {
    return { label: "匯款人名稱相近", symbol: "≈", className: approximateClass };
  }

  const exactLabels: Record<string, string> = {
    銀行入帳金額與未入帳發票一致: "金額完全吻合",
    收款申報金額一致: "申報金額吻合",
    匯款帳號末五碼一致: "帳號末五碼吻合",
    匯款日期一致: "匯款日期吻合",
  };
  return {
    label: exactLabels[reason] ?? reason,
    symbol: "✓",
    className: exactClass,
  };
}

export default function ReconciliationPage() {
  const [checkingSession, setCheckingSession] = useState(true);
  const [me, setMe] = useState<Record<string, unknown> | null>(null);
  const [transactions, setTransactions] = useState<ReconciliationDashboardTransaction[]>([]);
  const [runs, setRuns] = useState<ReconciliationDashboardRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("pending");
  const [preview, setPreview] = useState<(ParsedBankCsv & { filename: string }) | null>(null);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/reconciliation", { cache: "no-store", credentials: "include" });
      const data = await readJson(response);
      if (!response.ok || !data.ok) throw new Error(String(data.error ?? "讀取對帳資料失敗"));
      setTransactions((data.transactions as ReconciliationDashboardTransaction[]) ?? []);
      setRuns((data.runs as ReconciliationDashboardRun[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "讀取對帳資料失敗");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const session = await fetchSessionWithRetry();
      if (session.ok && session.user) {
        if (String(session.user.role ?? "") === "KOL") {
          window.location.replace("/kol");
          return;
        }
        setMe(session.user);
      }
      setCheckingSession(false);
    })();
  }, []);

  useEffect(() => {
    if (me) void loadDashboard();
  }, [me, loadDashboard]);

  const counts = useMemo(
    () => ({
      pending: transactions.filter((row) => row.status === "suggested").length,
      unmatched: transactions.filter((row) => row.status === "unmatched").length,
      matched: transactions.filter((row) => row.status === "matched").length,
      ignored: transactions.filter((row) => row.status === "ignored").length,
      all: transactions.length,
    }),
    [transactions]
  );

  const filteredTransactions = useMemo(() => {
    if (filter === "all") return transactions;
    if (filter === "pending") return transactions.filter((row) => row.status === "suggested");
    return transactions.filter((row) => row.status === filter);
  }, [filter, transactions]);

  const previewCredits = useMemo(
    () => preview?.rows.filter((row) => row.direction !== "debit") ?? [],
    [preview]
  );

  async function chooseFile(file: File | null) {
    setPreview(null);
    setError(null);
    setNotice(null);
    if (!file) return;
    try {
      const parsed = parseBankCsv(await file.arrayBuffer());
      setPreview({ ...parsed, filename: file.name });
      const creditCount = parsed.rows.filter((row) => row.direction !== "debit").length;
      if (parsed.rows.length === 0) setError(parsed.errors[0] ?? "找不到可匯入的交易");
      else if (creditCount === 0) setError("檔案內沒有入帳交易；支出已全部略過");
    } catch (e) {
      setError(e instanceof Error ? e.message : "無法解析 CSV");
    }
  }

  async function importPreview() {
    if (!preview || previewCredits.length === 0) return;
    setActionId("import");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/reconciliation/import", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: preview.filename, rows: previewCredits }),
      });
      const data = await readJson(response);
      if (!response.ok || !data.ok) throw new Error(String(data.error ?? "匯入失敗"));
      const matching = (data.matching ?? {}) as Record<string, unknown>;
      setNotice(
        `匯入 ${Number(data.imported ?? 0)} 筆，略過重複 ${Number(data.duplicates ?? 0)} 筆；產生 ${Number(matching.candidates ?? 0)} 個匹配候選。`
      );
      setPreview(null);
      setFilter("pending");
      await loadDashboard();
    } catch (e) {
      setError(e instanceof Error ? e.message : "匯入失敗");
    } finally {
      setActionId(null);
    }
  }

  async function postAction(body: Record<string, unknown>, id: string, successMessage: string) {
    setActionId(id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/reconciliation", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await readJson(response);
      if (!response.ok || !data.ok) throw new Error(String(data.error ?? "操作失敗"));
      const syncWarning = String(data.syncWarning ?? "").trim();
      setNotice(syncWarning ? `${successMessage}；但後續同步發生問題：${syncWarning}` : successMessage);
      await loadDashboard();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失敗");
    } finally {
      setActionId(null);
    }
  }

  if (checkingSession) {
    return <div className="flex min-h-screen items-center justify-center bg-[#faf8f5] text-stone-500">載入中…</div>;
  }
  if (!me) {
    return (
      <ErpLoginPanel
        subtitle="請先登入，再進入銀行對帳"
        onSuccess={(user) => {
          setMe(user);
        }}
      />
    );
  }

  const filterOptions: Array<{ key: FilterKey; label: string }> = [
    { key: "pending", label: "待確認" },
    { key: "unmatched", label: "未匹配" },
    { key: "matched", label: "已入帳" },
    { key: "ignored", label: "已忽略" },
    { key: "all", label: "全部" },
  ];

  return (
    <main className="min-h-screen bg-gradient-to-b from-[#fffbf5] via-[#faf8f5] to-[#f0ebe3] px-4 py-6 text-stone-800 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link href="/dashboard" className="text-xs font-semibold text-amber-800 hover:text-amber-950">
              ← 回到 ERP
            </Link>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-stone-900">銀行收款對帳</h1>
            <p className="mt-1 text-sm text-stone-500">先找出可能的專案，經你確認後才會更新發票入帳日。</p>
          </div>
          <button
            type="button"
            disabled={loading || actionId != null}
            onClick={() => void postAction({ action: "runMatching" }, "matching", "已重新計算匹配候選")}
            className="rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm font-bold shadow-sm hover:border-amber-300 disabled:opacity-50"
          >
            {actionId === "matching" ? "計算中…" : "重新比對"}
          </button>
        </header>

        {notice ? <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">{notice}</p> : null}
        {error ? <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">{error}</p> : null}

        <section className="mt-5 rounded-2xl border border-stone-200 bg-white/90 p-4 shadow-lg sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="font-bold text-stone-900">1. 匯入國泰交易 CSV</h2>
              <p className="mt-1 text-xs leading-5 text-stone-500">支援國泰下載的 Detail.xls、UTF-8／Big5 CSV。提出金額不會匯入；相同交易再次上傳會自動略過。</p>
            </div>
            <label className="inline-flex cursor-pointer items-center justify-center rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-bold text-stone-900 shadow-sm hover:bg-amber-400">
              選擇銀行檔案
              <input
                type="file"
                accept=".xls,.csv,.txt,application/vnd.ms-excel,text/csv,text/plain,text/html"
                className="sr-only"
                onChange={(event) => void chooseFile(event.target.files?.[0] ?? null)}
              />
            </label>
          </div>

          {preview ? (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/50 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-bold text-stone-900">{preview.filename}</p>
                  <p className="mt-1 text-xs text-stone-600">
                    偵測 {preview.format}／{preview.encoding}；可匯入 {previewCredits.length} 筆入帳交易
                    {preview.rows.length > previewCredits.length ? `，另有 ${preview.rows.length - previewCredits.length} 筆支出已自動略過` : ""}
                  </p>
                  {preview.errors.length > 0 ? <p className="mt-1 text-xs text-red-700">另有 {preview.errors.length} 列無法辨識，匯入時會略過。</p> : null}
                </div>
                <button
                  type="button"
                  disabled={actionId != null || previewCredits.length === 0}
                  onClick={() => void importPreview()}
                  className="rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-stone-700 disabled:opacity-50"
                >
                  {actionId === "import" ? "匯入與比對中…" : "確認匯入"}
                </button>
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-left text-xs">
                  <thead className="text-stone-500"><tr><th className="px-2 py-2">日期</th><th className="px-2 py-2">方向</th><th className="px-2 py-2 text-right">金額</th><th className="px-2 py-2">匯款人</th><th className="px-2 py-2">末五碼</th><th className="px-2 py-2">摘要</th></tr></thead>
                  <tbody className="divide-y divide-amber-100">
                    {previewCredits.slice(0, 8).map((row: BankImportRow, index) => (
                      <tr key={`${row.transactionDate}-${index}`}>
                        <td className="whitespace-nowrap px-2 py-2">{row.transactionDate}</td>
                        <td className="px-2 py-2">入帳</td>
                        <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{money(Number(row.amount), String(row.currency ?? "TWD"))}</td>
                        <td className="px-2 py-2">{row.counterpartyName || "—"}</td>
                        <td className="px-2 py-2 font-mono">{row.counterpartyLast5 || String(row.counterpartyAccount ?? "").replace(/\D/g, "").slice(-5) || "—"}</td>
                        <td className="max-w-xs truncate px-2 py-2">{row.description || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </section>

        <section className="mt-5 rounded-2xl border border-stone-200 bg-white/90 p-4 shadow-lg sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-bold text-stone-900">2. 檢查匹配結果</h2>
              <p className="mt-1 text-xs text-stone-500">分數只是輔助；請確認匯款人、金額、日期與發票後再按入帳。</p>
            </div>
            <div className="flex flex-wrap gap-1 rounded-xl bg-stone-100 p-1">
              {filterOptions.map((option) => (
                <button
                  type="button"
                  key={option.key}
                  onClick={() => setFilter(option.key)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${filter === option.key ? "bg-white text-stone-900 shadow-sm" : "text-stone-500"}`}
                >
                  {option.label} {counts[option.key]}
                </button>
              ))}
            </div>
          </div>

          {loading ? <p className="py-12 text-center text-sm text-stone-500">讀取中…</p> : null}
          {!loading && filteredTransactions.length === 0 ? <p className="py-12 text-center text-sm text-stone-500">這個分類目前沒有交易。</p> : null}
          <div className="mt-4 space-y-4">
            {filteredTransactions.map((transaction) => (
              <article key={transaction.id} className="rounded-xl border border-stone-200 bg-white p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="grid flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div><p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">銀行入帳</p><p className="mt-1 text-lg font-bold tabular-nums text-stone-900">{money(transaction.amount, transaction.currency)}</p></div>
                    <div><p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">日期</p><p className="mt-1 text-sm font-semibold">{transaction.transactionDate}</p></div>
                    <div><p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">匯款人／末五碼</p><p className="mt-1 text-sm font-semibold">{transaction.counterpartyName || "—"} {transaction.counterpartyLast5 ? `· ${transaction.counterpartyLast5}` : ""}</p></div>
                    <div><p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">狀態</p><span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-xs font-bold ${statusClass(transaction.status)}`}>{statusLabel(transaction.status)}</span></div>
                  </div>
                  {transaction.status === "ignored" ? (
                    <button type="button" disabled={actionId != null} onClick={() => void postAction({ action: "reopen", transactionId: transaction.id }, transaction.id, "已恢復交易") } className="text-xs font-semibold text-stone-600 underline">恢復</button>
                  ) : transaction.status !== "matched" ? (
                    <button type="button" disabled={actionId != null} onClick={() => void postAction({ action: "ignore", transactionId: transaction.id }, transaction.id, "已忽略交易") } className="text-xs font-semibold text-stone-500 underline">這筆不需對帳</button>
                  ) : null}
                </div>
                {transaction.description ? <p className="mt-3 rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600">摘要：{transaction.description}</p> : null}

                {transaction.matches.filter((match) => match.status !== "rejected").length > 0 ? (
                  <div className="mt-3 grid gap-3 xl:grid-cols-2">
                    {transaction.matches.filter((match) => match.status !== "rejected").map((match) => (
                      <div key={match.id} className={`rounded-xl border p-3 ${match.status === "confirmed" ? "border-emerald-200 bg-emerald-50/40" : "border-amber-200 bg-amber-50/40"}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-bold text-stone-900">{match.projectName || match.projectId}</p>
                            <p className="mt-0.5 text-xs text-stone-500">專案 {match.projectId}</p>
                          </div>
                          <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-bold ${scoreClass(match.score)}`}>{match.score} 分</span>
                        </div>
                        <div className="mt-2 rounded-lg border border-white/80 bg-white/70 px-3 py-2">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">對應發票／開立日期</p>
                          <ul className="mt-1 space-y-1 text-xs text-stone-700">
                            {match.invoices.length > 0 ? match.invoices.map((invoice) => (
                              <li key={invoice.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
                                <span className="font-semibold">{invoice.number || "未填發票號碼"}</span>
                                <span className="tabular-nums text-stone-500">{invoice.issueDate || "未填開立日期"}</span>
                              </li>
                            )) : (
                              <li>{match.invoiceNumbers.join("、") || "未填發票資料"}</li>
                            )}
                          </ul>
                        </div>
                        <p className="mt-2 text-sm font-bold tabular-nums">候選金額 {money(match.candidateAmount, transaction.currency)}</p>
                        <div className="mt-3">
                          <p className="text-xs font-bold text-stone-500">系統判斷依據</p>
                          <ul className="mt-2 flex flex-wrap gap-2">
                            {match.reasons.map((reason) => {
                              const display = reasonDisplay(reason);
                              return (
                                <li
                                  key={reason}
                                  className={`inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-bold leading-5 shadow-sm ${display.className}`}
                                >
                                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/80 text-sm font-black" aria-hidden="true">
                                    {display.symbol}
                                  </span>
                                  {display.label}
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                        {match.status === "confirmed" ? (
                          <p className="mt-3 text-xs font-bold text-emerald-800">已由 {match.confirmedBy || "財務人員"} 確認入帳</p>
                        ) : (
                          <div className="mt-3 flex gap-2">
                            <button
                              type="button"
                              disabled={actionId != null}
                              onClick={() => {
                                if (window.confirm(`確定將 ${transaction.transactionDate} 的 ${money(transaction.amount, transaction.currency)} 寫入專案 ${match.projectId} 的發票入帳日？`)) {
                                  void postAction({ action: "confirm", matchId: match.id }, match.id, "已確認入帳並同步 ERP 財務資料");
                                }
                              }}
                              className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
                            >
                              {actionId === match.id ? "處理中…" : "確認入帳"}
                            </button>
                            <button type="button" disabled={actionId != null} onClick={() => void postAction({ action: "reject", matchId: match.id }, match.id, "已排除此候選") } className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-bold text-stone-600 hover:border-stone-300 disabled:opacity-50">不是這筆</button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : transaction.status === "unmatched" ? (
                  <p className="mt-3 rounded-lg border border-dashed border-stone-200 px-3 py-3 text-xs text-stone-500">目前找不到金額相同的未入帳發票。可先檢查發票是否已綁定專案及填寫含稅金額。</p>
                ) : null}
              </article>
            ))}
          </div>
        </section>

        {runs.length > 0 ? (
          <section className="mt-5 rounded-2xl border border-stone-200 bg-white/80 p-4 shadow-sm sm:p-6">
            <h2 className="font-bold text-stone-900">最近匯入紀錄</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-left text-xs"><thead className="text-stone-400"><tr><th className="px-2 py-2">時間</th><th className="px-2 py-2">檔案</th><th className="px-2 py-2 text-right">原始</th><th className="px-2 py-2 text-right">匯入</th><th className="px-2 py-2 text-right">重複</th><th className="px-2 py-2">執行人</th></tr></thead><tbody className="divide-y divide-stone-100">{runs.map((run) => <tr key={run.id}><td className="whitespace-nowrap px-2 py-2">{new Date(run.createdAt).toLocaleString("zh-TW")}</td><td className="px-2 py-2">{run.filename || "—"}</td><td className="px-2 py-2 text-right">{run.rowCount}</td><td className="px-2 py-2 text-right">{run.importedCount}</td><td className="px-2 py-2 text-right">{run.duplicateCount}</td><td className="px-2 py-2">{run.createdBy}</td></tr>)}</tbody></table>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
