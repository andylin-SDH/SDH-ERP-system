"use client";

import { Fragment } from "react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchSessionWithRetry } from "@/components/ErpLoginPanel";
import type { PartnerRow } from "@/modules/partners";
import {
  buildKolCatalogItems,
  catalogCategoryTabs,
  type KolCatalogItem,
} from "@/lib/kol/catalog";
import { exportKolCatalogPdf } from "@/lib/kol/export-catalog-pdf";

async function safeResJson(r: Response): Promise<Record<string, unknown>> {
  const text = await r.text();
  if (!text.trim()) return {};
  try {
    return (JSON.parse(text) as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

function KolCatalogCard({ item }: { item: KolCatalogItem }) {
  const categories = [item.category1, item.category2, item.category3].filter(Boolean);
  return (
    <article className="catalog-card break-inside-avoid rounded-2xl border border-stone-200/90 bg-white shadow-sm ring-1 ring-stone-100">
      <div className="flex gap-4 p-4 sm:p-5">
        <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-amber-100 to-stone-100 ring-2 ring-amber-200/60 sm:h-28 sm:w-28">
          {item.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.avatarUrl} alt={item.name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-3xl font-bold text-amber-800/70">
              {item.name.charAt(0)}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div>
            <h3 className="text-lg font-bold leading-tight text-stone-900">{item.name}</h3>
            {item.channelName ? (
              <p className="mt-0.5 text-xs text-stone-500">{item.channelName}</p>
            ) : null}
          </div>
          {categories.length > 0 ? (
            <p className="mt-2 text-xs font-medium text-amber-900/80">{categories.join(" · ")}</p>
          ) : null}
          {item.followers ? (
            <div className="mt-3 text-xs">
              <span className="rounded-lg bg-stone-100 px-2 py-1 font-semibold tabular-nums text-stone-800">
                粉絲 {item.followers}
              </span>
            </div>
          ) : null}
          {item.socialLinks.length > 0 ? (
            <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px]">
              <span className="text-stone-500">平台：</span>
              {item.socialLinks.map((link, i) => (
                <Fragment key={link.url}>
                  {i > 0 ? <span className="text-stone-300">·</span> : null}
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-amber-800 underline decoration-amber-300/70 underline-offset-2 transition hover:text-amber-600"
                  >
                    {link.label}
                  </a>
                </Fragment>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export default function KolCatalogPage() {
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [items, setItems] = useState<KolCatalogItem[]>([]);
  const [categoryTab, setCategoryTab] = useState("all");
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportPdfError, setExportPdfError] = useState<string | null>(null);
  const pdfRootRef = useRef<HTMLElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setAuthError(null);
    setLoadError(null);
    const sess = await fetchSessionWithRetry();
    if (!sess.ok || !sess.user) {
      setAuthError("請先登入員工帳號後再預覽 KOL 型錄。");
      setLoading(false);
      return;
    }
    if (String(sess.user.role ?? "").trim() === "KOL") {
      setAuthError("此頁面僅供內部員工預覽與提案使用。");
      setLoading(false);
      return;
    }
    const res = await fetch("/api/partners", { credentials: "include", cache: "no-store" });
    const data = (await safeResJson(res)) as { ok?: boolean; partners?: PartnerRow[]; error?: string };
    if (!res.ok || !data.ok) {
      setLoadError(data.error ?? "無法載入 KOL 資料");
      setLoading(false);
      return;
    }
    setItems(buildKolCatalogItems(Array.isArray(data.partners) ? data.partners : []));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const tabs = useMemo(() => catalogCategoryTabs(items), [items]);
  const visibleItems = useMemo(
    () => (categoryTab === "all" ? items : items.filter((i) => (i.category1 || "未分類") === categoryTab)),
    [items, categoryTab]
  );

  const handleExportPdf = useCallback(async () => {
    const root = pdfRootRef.current;
    if (!root || exportingPdf) return;
    setExportPdfError(null);
    setExportingPdf(true);
    try {
      await exportKolCatalogPdf(root);
    } catch (e) {
      setExportPdfError(e instanceof Error ? e.message : "PDF 輸出失敗，請改用列印功能");
    } finally {
      setExportingPdf(false);
    }
  }, [exportingPdf]);

  const handlePrint = useCallback(() => {
    document.body.classList.add("kol-catalog-printing");
    const cleanup = () => {
      document.body.classList.remove("kol-catalog-printing");
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.print();
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-stone-500">載入 KOL 型錄預覽…</p>
      </div>
    );
  }

  if (authError) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
        <p className="text-amber-900">{authError}</p>
        <Link
          href="/dashboard"
          className="mt-4 rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-bold text-slate-900 hover:bg-amber-400"
        >
          前往登入
        </Link>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
        <p className="text-red-800">{loadError}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-4 rounded-xl border border-stone-300 bg-white px-5 py-2.5 text-sm font-semibold"
        >
          重試
        </button>
      </div>
    );
  }

  return (
    <>
      <style jsx global>{`
        @media print {
          @page {
            margin: 12mm;
          }
          body.kol-catalog-printing {
            background: white !important;
          }
          body.kol-catalog-printing * {
            visibility: hidden;
          }
          body.kol-catalog-printing #kol-catalog-output,
          body.kol-catalog-printing #kol-catalog-output * {
            visibility: visible;
          }
          body.kol-catalog-printing #kol-catalog-output {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            margin: 0 !important;
            padding: 0 !important;
            max-width: none !important;
          }
          body.kol-catalog-printing .kol-catalog-screen-only {
            display: none !important;
          }
          .catalog-cover {
            break-after: page;
            min-height: 100vh;
          }
          .catalog-card {
            break-inside: avoid;
            box-shadow: none !important;
          }
        }
      `}</style>

      {/* 工具列（僅螢幕預覽，不列入列印／PDF） */}
      <div className="kol-catalog-screen-only sticky top-0 z-20 border-b border-stone-200/90 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="text-sm font-semibold text-stone-600 hover:text-stone-900">
              ← 回 Dashboard
            </Link>
            <span className="hidden text-stone-300 sm:inline">|</span>
            <span className="text-sm font-medium text-stone-500">KOL 提案型錄 · 預覽</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={exportingPdf || visibleItems.length === 0}
              onClick={() => void handleExportPdf()}
              className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-slate-900 shadow-sm hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {exportingPdf ? "PDF 產製中…" : "輸出 PDF"}
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="rounded-xl border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50"
            >
              列印
            </button>
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-xl border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50"
            >
              重新整理
            </button>
          </div>
        </div>
        {exportPdfError ? (
          <p className="mx-auto max-w-6xl px-4 pb-2 text-xs text-red-700 sm:px-6">{exportPdfError}</p>
        ) : null}
        {categoryTab !== "all" ? (
          <p className="mx-auto max-w-6xl px-4 pb-2 text-xs text-amber-800 sm:px-6">
            目前為分類篩選預覽；輸出 PDF 僅包含此分類的 KOL。若要完整型錄請先選「全部」。
          </p>
        ) : null}
      </div>

      <main
        id="kol-catalog-output"
        ref={pdfRootRef}
        className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12"
      >
        {/* 封面 */}
        <section className="catalog-cover mb-12 rounded-3xl border border-amber-200/80 bg-gradient-to-br from-[#fffbf5] via-white to-amber-50/80 p-8 shadow-lg ring-1 ring-amber-100 sm:p-12">
          <div className="flex flex-col gap-8 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <Image src="/logo.png" alt="SDH" width={240} height={56} className="h-12 w-auto object-contain" />
              <p className="mt-6 text-xs font-bold uppercase tracking-[0.2em] text-amber-800/80">KOL Roster</p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight text-stone-900 sm:text-4xl">
                盛德好 KOL 合作資源型錄
              </h1>
              <p className="mt-4 max-w-xl text-sm leading-relaxed text-stone-600">
                本型錄依 ERP 合作夥伴主檔自動產生，彙整旗下 KOL 的領域分類、社群影響力與可合作類型，
                供對外提案與內部媒合使用。資料不含分潤、合約與聯絡資訊。
              </p>
              <p className="mt-4 text-xs text-stone-500">
                產製日期：{new Date().toLocaleDateString("zh-TW", { year: "numeric", month: "long", day: "numeric" })}
              </p>
            </div>
            <div className="rounded-2xl bg-white/80 px-6 py-4 text-center ring-1 ring-stone-200/80">
              <p className="text-3xl font-bold tabular-nums text-stone-900">{items.length}</p>
              <p className="text-xs font-medium text-stone-500">KOL 總數</p>
            </div>
          </div>
        </section>

        {/* 分類篩選 */}
        <div className="kol-catalog-screen-only mb-6 flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setCategoryTab(tab.key)}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
                categoryTab === tab.key
                  ? "bg-amber-500 text-slate-900 shadow-sm"
                  : "bg-white text-stone-600 ring-1 ring-stone-200 hover:bg-stone-50"
              }`}
            >
              {tab.label}
              <span className="ml-1.5 text-xs opacity-70">({tab.count})</span>
            </button>
          ))}
        </div>

        {visibleItems.length === 0 ? (
          <p className="rounded-2xl border border-stone-200 bg-white px-6 py-16 text-center text-stone-500">
            目前沒有可顯示的 KOL 資料，請先在「合作夥伴」維護主檔。
          </p>
        ) : (
          <section className="grid gap-4 sm:grid-cols-2">
            {visibleItems.map((item) => (
              <KolCatalogCard key={item.id} item={item} />
            ))}
          </section>
        )}

        <footer className="mt-12 border-t border-stone-200 pt-6 text-center text-xs text-stone-500">
          <p>盛德好股份有限公司 · 內部提案用 · 資料來源：ERP 合作夥伴主檔</p>
          <p className="kol-catalog-screen-only mt-1">按上方「輸出 PDF」可一鍵下載；或使用「列印」另存為 PDF。</p>
        </footer>
      </main>
    </>
  );
}
