"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { InvoiceRequestProjectSummary, InvoiceRequestRow } from "@/lib/db/invoice-requests";
import { invoiceEInvoiceLaunchLabel, isInvoiceEInvoiceLive } from "@/lib/invoice/launch";

const STATUS = ["待審核", "已放行", "已退回"] as const;

function taxLabel(kind: string, mode: string): string {
  const tax = kind === "zero" ? "零稅率" : kind === "exempt" ? "免稅" : "應稅 5%";
  return `${tax} · ${mode === "taxed" ? "含稅" : "未稅"}`;
}

function formatMoney(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(String(value).replace(/,/g, ""));
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString("zh-TW");
}

function ProjectSummaryBlock({ project }: { project: InvoiceRequestProjectSummary }) {
  const fields: Array<[string, string]> = [
    ["專案狀態", project.專案狀態 || "—"],
    ["開案日期", project.開案日期 || "—"],
    ["廠商（發票抬頭）", project.廠商名稱 || "—"],
    ["統一編號", project.統一編號 || "—"],
    ["收件人 Email", project.收件人Email || "—"],
    ["KOL", project.KOL名稱 || "—"],
    ["負責 PM", project.執行管理員 || "—"],
    ["預計付款日", project.廠商預計付款日 || "—"],
    ["專案總金額未稅", formatMoney(project.專案總金額未稅)],
    ["專案額外成本", formatMoney(project.專案成本)],
    ["KOL費用未稅", formatMoney(project.KOL費用未稅)],
    ["車馬費等", formatMoney(project.KOL應收額外成本)],
    ["專案營收", formatMoney(project.專案營收)],
  ];
  return (
    <div className="rounded-xl border border-emerald-200/80 bg-gradient-to-br from-emerald-50/90 via-white to-amber-50/40 p-3">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800">專案細節</p>
          <p className="mt-0.5 break-words text-sm font-bold text-stone-900">
            {project.專案名稱 || project.專案ID}
          </p>
          <p className="mt-0.5 text-[11px] text-stone-500">{project.專案ID}</p>
        </div>
        <Link
          href={`/dashboard?project=${encodeURIComponent(project.專案ID)}`}
          className="shrink-0 rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-emerald-900 hover:bg-emerald-50"
        >
          打開專案
        </Link>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        {fields.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-[10px] font-semibold text-stone-400">{label}</dt>
            <dd className="mt-0.5 truncate font-medium text-stone-800" title={value}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
      {project.專案內容 ? (
        <div className="mt-2 border-t border-emerald-100 pt-2">
          <p className="text-[10px] font-semibold text-stone-400">專案內容</p>
          <p className="mt-0.5 line-clamp-4 whitespace-pre-wrap text-xs leading-relaxed text-stone-600">
            {project.專案內容}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function InvoiceReviewPanel({ canReview, reloadToken = 0 }: { canReview: boolean; reloadToken?: number }) {
  const issueLive = isInvoiceEInvoiceLive();
  const [rows, setRows] = useState<InvoiceRequestRow[]>([]);
  const [status, setStatus] = useState<(typeof STATUS)[number]>("待審核");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/invoices/amego/requests", { credentials: "include", cache: "no-store" });
      const data = (await res.json()) as { ok?: boolean; error?: string; requests?: InvoiceRequestRow[] };
      if (!res.ok || !data.ok) {
        setError(data.error || "無法讀取申請");
        return;
      }
      setRows(data.requests ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "無法讀取申請");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  async function review(id: string, action: "approve" | "reject") {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch("/api/invoices/amego/requests/review", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, reason }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; mailNotice?: string };
      if (!res.ok || !data.ok) {
        setError(data.error || "審核失敗");
        return;
      }
      setNotice(data.mailNotice?.trim() || null);
      setRejectId(null);
      setReason("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "審核失敗");
    } finally {
      setBusyId(null);
    }
  }

  const visible = rows.filter((row) => row.狀態 === status);

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1 rounded-xl border border-stone-200 bg-stone-50 p-1">
        {STATUS.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setStatus(item)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
              status === item ? "bg-amber-500 text-slate-900" : "text-stone-500 hover:text-stone-900"
            }`}
          >
            {item}
            <span className="ml-1 tabular-nums">{rows.filter((row) => row.狀態 === item).length}</span>
          </button>
        ))}
      </div>
      {!issueLive ? (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          申請會先留在這裡。{invoiceEInvoiceLaunchLabel()} 起才能按「放行並開立」，在那之前不會向光貿開立。
        </p>
      ) : null}
      {issueLive ? (
        <p className="mb-3 text-xs text-stone-500">開立完成後會寄信給專案上的專案負責人和主管。同一人只寄一封。</p>
      ) : null}
      {notice ? (
        <p
          className={`mb-3 rounded-lg px-3 py-2 text-sm ${
            notice.includes("沒有寄出") || notice.includes("未寄")
              ? "bg-amber-50 text-amber-950"
              : "bg-emerald-50 text-emerald-900"
          }`}
        >
          {notice}
        </p>
      ) : null}
      {error ? <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
      {loading ? <p className="text-sm text-stone-500">載入申請…</p> : null}
      {!loading && !error && visible.length === 0 ? <p className="py-8 text-center text-sm text-stone-500">沒有{status}的申請</p> : null}
      <div className="space-y-4">
        {visible.map((row) => {
          const project = row.專案摘要;
          const title = project?.專案名稱 || row.明細[0]?.description || row.專案ID || "未綁專案";
          return (
            <article key={row.id} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-words text-base font-bold text-stone-900">{title}</p>
                  <p className="mt-1 text-xs text-stone-500">
                    {row.外部單號 ? `錄音室預約 ${row.外部單號.replace(/^booking:/, "")}` : row.專案ID || "未綁專案"} · {row.申請人 || row.申請人Email} · {taxLabel(row.課稅別, row.單價模式)}
                    {row.申請時間 ? ` · ${row.申請時間.slice(0, 16).replace("T", " ")}` : ""}
                  </p>
                </div>
                <p className="rounded-full bg-sky-50 px-3 py-1 text-sm font-bold tabular-nums text-sky-900">
                  含稅 {formatMoney(row.發票總金額)}
                </p>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-sky-100 bg-sky-50/40 p-3">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-sky-800">這次要開的發票</p>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                    <div>
                      <dt className="text-[10px] font-semibold text-stone-400">統編</dt>
                      <dd className="mt-0.5 font-medium text-stone-800">{row.買受人統編 || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-semibold text-stone-400">買受人</dt>
                      <dd className="mt-0.5 font-medium text-stone-800">{row.買受人名稱 || "—"}</dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-[10px] font-semibold text-stone-400">Email</dt>
                      <dd className="mt-0.5 break-all font-medium text-stone-800">{row.買受人Email || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-semibold text-stone-400">銷售額</dt>
                      <dd className="mt-0.5 font-medium tabular-nums text-stone-800">{formatMoney(row.銷售額)}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-semibold text-stone-400">稅額</dt>
                      <dd className="mt-0.5 font-medium tabular-nums text-stone-800">{formatMoney(row.稅額)}</dd>
                    </div>
                  </dl>
                  {row.明細.length > 0 ? (
                    <div className="mt-3 overflow-hidden rounded-lg border border-sky-100 bg-white">
                      <table className="min-w-full text-left text-[11px]">
                        <thead className="bg-sky-50 text-stone-500">
                          <tr>
                            <th className="px-2 py-1.5 font-semibold">品名</th>
                            <th className="px-2 py-1.5 font-semibold">數量</th>
                            <th className="px-2 py-1.5 text-right font-semibold">單價</th>
                          </tr>
                        </thead>
                        <tbody>
                          {row.明細.map((line, idx) => (
                            <tr key={`${row.id}-line-${idx}`} className="border-t border-stone-100">
                              <td className="max-w-[12rem] px-2 py-1.5 text-stone-800">
                                <span className="line-clamp-2">{line.description || "—"}</span>
                              </td>
                              <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-stone-700">{line.quantity}</td>
                              <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-stone-800">
                                {formatMoney(line.unitPrice)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                  {row.發票備註 ? (
                    <p className="mt-2 text-[11px] text-stone-600">備註：{row.發票備註}</p>
                  ) : null}
                </div>

                {project ? (
                  <ProjectSummaryBlock project={project} />
                ) : (
                  <div className="rounded-xl border border-dashed border-stone-200 bg-stone-50/80 p-3 text-sm text-stone-500">
                    {row.外部單號
                      ? "這筆來自錄音室預約，沒有對應大總表專案。放行後會開立並進入發票清冊。"
                      : row.專案ID
                        ? `找不到專案 ${row.專案ID} 的大總表資料`
                        : "這筆申請沒有綁專案"}
                  </div>
                )}
              </div>

              {row.已有發票 && row.狀態 === "待審核" ? (
                <p className="mt-3 text-xs font-semibold text-amber-800">這個專案清冊裡已經有發票，放行會再開一張。</p>
              ) : null}
              {row.開立錯誤 ? <p className="mt-2 text-xs text-red-700">上次開立失敗：{row.開立錯誤}</p> : null}
              {row.退回原因 ? <p className="mt-2 text-xs text-stone-600">退回原因：{row.退回原因}</p> : null}
              {row.發票號碼 ? <p className="mt-2 text-xs font-semibold text-emerald-800">發票號碼 {row.發票號碼}</p> : null}

              {canReview && row.狀態 === "待審核" ? (
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-stone-100 pt-3">
                  <button
                    type="button"
                    disabled={!issueLive || busyId === row.id}
                    onClick={() => issueLive && void review(row.id, "approve")}
                    className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60"
                  >
                    {busyId === row.id ? "處理中…" : issueLive ? "放行並開立" : `${invoiceEInvoiceLaunchLabel()} 才能開立`}
                  </button>
                  {rejectId === row.id ? (
                    <>
                      <input
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="退回原因"
                        className="rounded-lg border border-stone-300 px-2 py-1 text-xs"
                      />
                      <button
                        type="button"
                        disabled={busyId === row.id || !reason.trim()}
                        onClick={() => void review(row.id, "reject")}
                        className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 disabled:opacity-60"
                      >
                        確認退回
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setRejectId(row.id);
                        setReason("");
                      }}
                      className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-semibold text-stone-700"
                    >
                      退回
                    </button>
                  )}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}
