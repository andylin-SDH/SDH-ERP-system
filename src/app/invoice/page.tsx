"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { InvoiceReviewPanel } from "@/components/invoice/InvoiceReviewPanel";
import { canReviewInvoice } from "@/lib/invoice/review-access";
import {
  invoiceEInvoiceLaunchLabel,
  invoiceEInvoiceLockedMessage,
  isInvoiceEInvoiceLive,
} from "@/lib/invoice/launch";
import { fetchSessionWithRetry } from "@/components/ErpLoginPanel";
import { calcB2bTotals, type B2bPriceMode, type B2bTaxKind } from "@/lib/invoice/b2b-amount";

type Line = { key: string; description: string; quantity: string; unitPrice: string };
type ProjectOption = { id: string; name: string; vendor: string; taxId: string; email: string; untaxed: string; kol: string };

function emptyLine(): Line {
  return { key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, description: "", quantity: "1", unitPrice: "" };
}

function moneyInput(raw: string): string {
  const n = Number(String(raw).replace(/,/g, "").trim());
  if (!Number.isFinite(n) || n <= 0) return "";
  return String(Math.round(n));
}

function ProjectPicker({
  projects,
  projectId,
  onSelect,
}: {
  projects: ProjectOption[];
  projectId: string;
  onSelect: (id: string) => void;
}) {
  const selected = projects.find((item) => item.id === projectId);
  const [query, setQuery] = useState(selected ? selected.name || selected.id : "");
  const [open, setOpen] = useState(false);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q
      ? projects.filter((item) => `${item.name} ${item.id} ${item.vendor} ${item.kol}`.toLowerCase().includes(q))
      : projects;
    return rows.slice(0, 30);
  }, [projects, query]);

  useEffect(() => {
    const current = projects.find((item) => item.id === projectId);
    setQuery(current ? current.name || current.id : "");
  }, [projectId, projects]);

  return (
    <div className="relative">
      <input
        value={query}
        placeholder="搜尋專案名稱"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          if (e.target.value.trim() === "") onSelect("");
        }}
        onBlur={() => {
          window.setTimeout(() => {
            setOpen(false);
            const current = projects.find((item) => item.id === projectId);
            setQuery(current ? current.name || current.id : "");
          }, 120);
        }}
        className={fieldClass()}
      />
      {open ? (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-auto rounded-lg border border-stone-200 bg-white py-1 text-sm shadow-xl">
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect("");
              setQuery("");
              setOpen(false);
            }}
            className="block w-full px-3 py-2 text-left text-stone-500 hover:bg-sky-50"
          >
            不綁定專案
          </button>
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-stone-400">沒有符合的專案</div>
          ) : (
            filtered.map((item) => (
              <button
                key={item.id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(item.id);
                  setQuery(item.name || item.id);
                  setOpen(false);
                }}
                className="block w-full px-3 py-2 text-left hover:bg-sky-50"
              >
                <span className="block truncate font-medium text-stone-900">{item.name || item.id}</span>
                <span className="block truncate text-[11px] text-stone-500">
                  {item.id}
                  {item.vendor ? ` · ${item.vendor}` : ""}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function fieldClass() {
  return "w-full border-0 border-b border-stone-300 bg-transparent px-0 py-2 text-sm text-stone-900 outline-none placeholder:text-stone-400 focus:border-sky-600";
}

export default function InvoiceIssuePage() {
  const [ready, setReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [buyerIdentifier, setBuyerIdentifier] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [remark, setRemark] = useState("");
  const [buyerAddress, setBuyerAddress] = useState("");
  const [projectId, setProjectId] = useState("");
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [moreOpen, setMoreOpen] = useState(true);
  const [taxKind, setTaxKind] = useState<B2bTaxKind>("taxable");
  const [priceMode, setPriceMode] = useState<B2bPriceMode>("untaxed");
  const [customs, setCustoms] = useState<1 | 2>(1);
  const [zeroReason, setZeroReason] = useState(72);
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ totalAmount: number } | null>(null);
  const [canReview, setCanReview] = useState(false);
  const [requestTick, setRequestTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void fetchSessionWithRetry().then(async (sess) => {
      if (cancelled) return;
      if (!sess.ok || !sess.user) {
        window.location.replace("/?next=/invoice");
        return;
      }
      if (String(sess.user.role ?? "").trim() === "KOL") {
        setAuthError("此頁面僅供內部開立發票。");
        return;
      }
      setReady(true);
      setCanReview(canReviewInvoice(String(sess.user.role ?? "")));
      const res = await fetch("/api/invoices/amego/projects", { credentials: "include", cache: "no-store" });
      const data = (await res.json()) as { ok?: boolean; projects?: ProjectOption[] };
      if (cancelled || !res.ok || !data.ok || !Array.isArray(data.projects)) return;
      setProjects(data.projects);
      const preset = new URLSearchParams(window.location.search).get("project")?.trim() ?? "";
      const project = data.projects.find((item) => item.id === preset);
      if (!project) return;
      setProjectId(project.id);
      if (project.vendor) setBuyerName(project.vendor);
      if (project.taxId) setBuyerIdentifier(project.taxId);
      if (project.email) setBuyerEmail(project.email);
      setPriceMode("untaxed");
      const price = moneyInput(project.untaxed);
      setLines((prev) => {
        const first = prev[0] ?? emptyLine();
        return [
          {
            ...first,
            description: project.name || first.description,
            unitPrice: price || first.unitPrice,
            quantity: first.quantity || "1",
          },
          ...prev.slice(1),
        ];
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const totals = useMemo(
    () =>
      calcB2bTotals(
        lines.map((line) => ({
          description: line.description,
          quantity: Number(line.quantity),
          unitPrice: Number(String(line.unitPrice).replace(/,/g, "")),
        })),
        taxKind,
        priceMode,
        { requireDescription: false }
      ),
    [lines, taxKind, priceMode]
  );

  function selectProject(id: string) {
    setProjectId(id);
    const project = projects.find((item) => item.id === id);
    if (!project) return;
    if (project.vendor) setBuyerName(project.vendor);
    if (project.taxId) setBuyerIdentifier(project.taxId);
    if (project.email) setBuyerEmail(project.email);
    setPriceMode("untaxed");
    const price = moneyInput(project.untaxed);
    setLines((prev) => {
      const first = prev[0] ?? emptyLine();
      return [{ ...first, description: project.name || first.description, unitPrice: price || first.unitPrice, quantity: first.quantity || "1" }, ...prev.slice(1)];
    });
  }

  function updateLine(key: string, patch: Partial<Line>) {
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  async function submit() {
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/invoices/amego/requests", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          buyerIdentifier,
          buyerName,
          buyerEmail,
          buyerAddress,
          projectId,
          remark,
          taxKind,
          priceMode,
          customsClearanceMark: customs,
          zeroTaxRateReason: zeroReason,
          items: lines.map((line) => ({
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
          })),
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error || "送審失敗");
        return;
      }
      setSuccess({ totalAmount: totals.totalAmount });
      setRequestTick((tick) => tick + 1);
      setLines([emptyLine()]);
      setRemark("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "送審失敗");
    } finally {
      setSubmitting(false);
    }
  }

  if (authError) {
    return <p className="p-8 text-sm text-stone-600">{authError}</p>;
  }
  if (!isInvoiceEInvoiceLive()) {
    return (
      <div className="min-h-screen bg-[#f7f8fa] px-4 py-10 text-stone-900">
        <div className="mx-auto max-w-3xl">
          <div className="rounded-2xl border border-stone-200 bg-white px-6 py-8 text-center shadow-sm">
            <h1 className="text-xl font-bold">開立發票</h1>
            <p className="mt-3 text-sm text-stone-600">{invoiceEInvoiceLockedMessage()}</p>
            <p className="mt-1 text-xs text-stone-400">錄音室預約的申請會先進入下面的待審核，{invoiceEInvoiceLaunchLabel()}（台北時間）起才能放行開立。開立完成會寄信通知申請人。</p>
            <Link
              href="/dashboard"
              className="mt-6 inline-flex rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-semibold text-stone-700 hover:bg-stone-50"
            >
              回專案
            </Link>
          </div>
          {canReview ? (
            <section className="mt-8">
              <h2 className="mb-3 text-base font-bold text-stone-900">開立申請</h2>
              <InvoiceReviewPanel canReview={canReview} reloadToken={requestTick} />
            </section>
          ) : null}
        </div>
      </div>
    );
  }
  if (!ready) {
    return <p className="p-8 text-sm text-stone-500">載入開立發票…</p>;
  }

  return (
    <div className="min-h-screen bg-[#f7f8fa] text-stone-900">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div>
            <h1 className="text-xl font-bold">開立發票</h1>
            <p className="mt-0.5 text-xs text-stone-500">B2B。送出後由董事長或會計核對，放行才會開立。開立完成會寄信通知申請人。</p>
          </div>
          <Link
            href={
              projectId.trim()
                ? `/dashboard?project=${encodeURIComponent(projectId.trim())}`
                : "/dashboard"
            }
            className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-semibold text-stone-700 hover:bg-stone-50"
          >
            回專案
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        {success ? (
          <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            已送出審核。含稅 {success.totalAmount.toLocaleString("zh-TW")} 元。董事長或會計放行後才會開立，完成後會寄信到你的帳號信箱。
          </div>
        ) : null}
        {error ? <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p> : null}

        <section className="rounded-2xl border border-stone-200 bg-white px-4 py-6 shadow-sm sm:px-8">
          <div className="mb-6 flex flex-wrap items-center gap-6 text-sm">
            <span className="font-semibold text-sky-700">
              發票類型 <span className="text-red-500">*</span>
            </span>
            <span className="inline-flex items-center gap-2 font-medium">
              <span className="inline-block h-3.5 w-3.5 rounded-full border-[5px] border-sky-600 bg-white" />
              B2B：對方有統編
            </span>
          </div>

          <div className="mb-6">
            <span className="text-sm font-semibold text-sky-700">專案</span>
            <ProjectPicker projects={projects} projectId={projectId} onSelect={selectProject} />
            <p className="mt-1 text-[11px] text-stone-500">選了之後帶入廠商名稱（發票抬頭）、統一編號、收件人 Email、專案名稱和未稅金額。同一專案再開第二張時，訂單編號會自動加尾碼。</p>
          </div>

          <div className="grid gap-x-10 gap-y-5 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-semibold text-sky-700">
                買受人統編 <span className="text-red-500">*</span>
              </span>
              <input value={buyerIdentifier} onChange={(e) => setBuyerIdentifier(e.target.value)} placeholder="請輸入買受人統編" maxLength={8} className={fieldClass()} />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-sky-700">
                買受人名稱 <span className="text-red-500">*</span>
              </span>
              <input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} placeholder="請輸入買受人名稱" className={fieldClass()} />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-sky-700">
                買受人 Email <span className="text-red-500">*</span>
              </span>
              <input value={buyerEmail} onChange={(e) => setBuyerEmail(e.target.value)} placeholder="請輸入電子郵件信箱，使用 , 分隔多組 email" className={fieldClass()} />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-sky-700">發票備註</span>
              <input value={remark} onChange={(e) => setRemark(e.target.value)} maxLength={200} className={fieldClass()} />
            </label>
          </div>

          <div className="mt-3 text-right">
            <button type="button" onClick={() => setMoreOpen((v) => !v)} className="text-sm font-semibold text-sky-700">
              {moreOpen ? "隱藏更多欄位" : "展開更多欄位"}
            </button>
          </div>
          {moreOpen ? (
            <div className="mt-4">
              <label className="block">
                <span className="text-sm font-semibold text-sky-700">買受人地址</span>
                <input value={buyerAddress} onChange={(e) => setBuyerAddress(e.target.value)} className={fieldClass()} />
              </label>
            </div>
          ) : null}

          <div className="mt-8">
            <p className="text-sm font-semibold text-sky-700">
              課稅別 <span className="text-red-500">*</span>
            </p>
            <div className="mt-2 flex flex-wrap gap-6 text-sm">
              {(
                [
                  ["taxable", "應稅 5%"],
                  ["zero", "零稅率"],
                  ["exempt", "免稅"],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="inline-flex items-center gap-2">
                  <input type="radio" name="taxKind" checked={taxKind === value} onChange={() => setTaxKind(value)} />
                  {label}
                </label>
              ))}
            </div>
            {taxKind === "zero" ? (
              <div className="mt-3 flex flex-wrap gap-4 text-sm">
                <label>
                  通關方式
                  <select value={customs} onChange={(e) => setCustoms(Number(e.target.value) === 2 ? 2 : 1)} className="ml-2 rounded border border-stone-300 px-2 py-1">
                    <option value={1}>非經海關出口</option>
                    <option value={2}>經海關出口</option>
                  </select>
                </label>
                <label>
                  零稅率原因
                  <select value={zeroReason} onChange={(e) => setZeroReason(Number(e.target.value))} className="ml-2 rounded border border-stone-300 px-2 py-1">
                    <option value={71}>71 外銷貨物</option>
                    <option value={72}>72 與外銷有關之勞務</option>
                    <option value={79}>79 其他</option>
                  </select>
                </label>
              </div>
            ) : null}
          </div>

          <div className="mt-8">
            <p className="text-sm font-semibold text-sky-700">發票明細</p>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-200 text-left text-sky-700">
                    <th className="py-2 pr-3 font-semibold">品名 <span className="text-red-500">*</span></th>
                    <th className="w-24 py-2 pr-3 font-semibold">數量 <span className="text-red-500">*</span></th>
                    <th className="w-64 py-2 pr-3 font-semibold">
                      <span className="mr-3">單價 <span className="text-red-500">*</span></span>
                      <label className="mr-2 font-medium text-stone-700">
                        <input type="radio" name="priceMode" checked={priceMode === "taxed"} onChange={() => setPriceMode("taxed")} className="mr-1" />
                        含稅
                      </label>
                      <label className="font-medium text-stone-700">
                        <input type="radio" name="priceMode" checked={priceMode === "untaxed"} onChange={() => setPriceMode("untaxed")} className="mr-1" />
                        未稅
                      </label>
                    </th>
                    <th className="w-28 py-2 text-right font-semibold">金額</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => {
                    const amount = Math.round(Number(line.quantity) * Number(String(line.unitPrice).replace(/,/g, "")));
                    return (
                      <tr key={line.key} className="border-b border-stone-100">
                        <td className="py-2 pr-3">
                          <input value={line.description} onChange={(e) => updateLine(line.key, { description: e.target.value })} placeholder="請輸入發票品名" className={fieldClass()} />
                        </td>
                        <td className="py-2 pr-3">
                          <input value={line.quantity} onChange={(e) => updateLine(line.key, { quantity: e.target.value })} inputMode="decimal" className={fieldClass()} />
                        </td>
                        <td className="py-2 pr-3">
                          <input value={line.unitPrice} onChange={(e) => updateLine(line.key, { unitPrice: e.target.value })} inputMode="decimal" placeholder="單價" className={fieldClass()} />
                        </td>
                        <td className="py-2 text-right tabular-nums text-stone-700">{Number.isFinite(amount) ? amount.toLocaleString("zh-TW") : "0"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <button type="button" onClick={() => setLines((prev) => [...prev, emptyLine()])} className="mt-3 text-sm font-semibold text-sky-700">
              新增一列
            </button>
          </div>

          <dl className="mt-6 ml-auto w-full max-w-xs space-y-1 text-right text-sm text-sky-800">
            <div className="flex justify-between"><dt>銷售額</dt><dd className="tabular-nums">{(taxKind === "exempt" ? totals.freeTaxSalesAmount : taxKind === "zero" ? totals.zeroTaxSalesAmount : totals.salesAmount).toLocaleString("zh-TW")}</dd></div>
            <div className="flex justify-between"><dt>稅額</dt><dd className="tabular-nums">{totals.taxAmount.toLocaleString("zh-TW")}</dd></div>
            <div className="flex justify-between font-bold"><dt>發票總金額</dt><dd className="tabular-nums">{totals.totalAmount.toLocaleString("zh-TW")}</dd></div>
          </dl>

          <div className="mt-8 flex justify-end">
            <button
              type="button"
              disabled={submitting}
              onClick={() => void submit()}
              className="rounded-lg bg-sky-600 px-6 py-2.5 text-sm font-bold text-white hover:bg-sky-700 disabled:opacity-60"
            >
              {submitting ? "送出中…" : "送出審核"}
            </button>
          </div>
        </section>
        <section className="mt-8">
          <h2 className="mb-3 text-base font-bold text-stone-900">{canReview ? "開立申請" : "我的申請"}</h2>
          <InvoiceReviewPanel canReview={canReview} reloadToken={requestTick} />
        </section>
      </main>
    </div>
  );
}
