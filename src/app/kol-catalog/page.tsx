"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchSessionWithRetry } from "@/components/ErpLoginPanel";
import { SocialLinkIcons } from "@/components/SocialLinkIcons";
import {
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
    <article className="group flex h-full flex-col overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-amber-200/90 hover:shadow-md">
      <div className="relative aspect-[4/3] overflow-hidden bg-gradient-to-br from-amber-50 to-stone-100">
        {item.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.avatarUrl}
            alt={item.name}
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-amber-100 to-stone-200 text-5xl font-bold text-amber-800/50">
            {item.name.charAt(0)}
          </div>
        )}
        {item.followers ? (
          <span className="absolute bottom-3 right-3 rounded-full bg-black/55 px-2.5 py-1 text-xs font-semibold tabular-nums text-white backdrop-blur-sm">
            {item.followers} 粉絲
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col p-4 sm:p-5">
        <h3 className="text-lg font-bold leading-snug text-stone-900">{item.name}</h3>
        {item.channelName ? (
          <p className="mt-1 text-sm text-stone-500">{item.channelName}</p>
        ) : null}

        {categories.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {categories.map((cat) => (
              <span
                key={cat}
                className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-900 ring-1 ring-amber-200/80"
              >
                {cat}
              </span>
            ))}
          </div>
        ) : null}

        {item.socialUrls ? (
          <div className="mt-auto pt-4">
            <SocialLinkIcons value={item.socialUrls} variant="light" />
          </div>
        ) : null}
      </div>
    </article>
  );
}

type CategoryTile = {
  key: string;
  label: string;
  count: number;
  previewAvatars: string[];
};

function buildCategoryTiles(items: KolCatalogItem[]): CategoryTile[] {
  const tabs = catalogCategoryTabs(items).filter((t) => t.key !== "all");
  return tabs.map((tab) => {
    const inCat = items.filter((i) => (i.category1 || "未分類") === tab.key);
    const previewAvatars = inCat
      .map((i) => i.avatarUrl)
      .filter(Boolean)
      .slice(0, 4);
    return {
      key: tab.key,
      label: tab.label,
      count: tab.count,
      previewAvatars,
    };
  });
}

export default function KolCatalogPage() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [items, setItems] = useState<KolCatalogItem[]>([]);
  /** null = 類別選擇首頁；字串 = 已選類別 */
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [isEmployee, setIsEmployee] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportPdfError, setExportPdfError] = useState<string | null>(null);
  const catalogRef = useRef<HTMLElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const res = await fetch("/api/public/kol-catalog", { cache: "no-store" });
    const data = (await safeResJson(res)) as {
      ok?: boolean;
      items?: KolCatalogItem[];
      error?: string;
    };
    if (!res.ok || !data.ok) {
      setLoadError(data.error ?? "無法載入 KOL 名單");
      setLoading(false);
      return;
    }
    setItems(Array.isArray(data.items) ? data.items : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      const sess = await fetchSessionWithRetry();
      if (sess.ok && sess.user && String(sess.user.role ?? "").trim() !== "KOL") {
        setIsEmployee(true);
      }
    })();
  }, []);

  const categoryTiles = useMemo(() => buildCategoryTiles(items), [items]);

  const visibleItems = useMemo(() => {
    if (!selectedCategory) return [];
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if ((item.category1 || "未分類") !== selectedCategory) return false;
      if (!q) return true;
      const hay = [item.name, item.channelName, item.category1, item.category2, item.category3]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [items, selectedCategory, search]);

  const handleExportPdf = useCallback(async () => {
    const root = catalogRef.current;
    if (!root || exportingPdf) return;
    setExportPdfError(null);
    setExportingPdf(true);
    try {
      await exportKolCatalogPdf(root);
    } catch (e) {
      setExportPdfError(e instanceof Error ? e.message : "PDF 輸出失敗");
    } finally {
      setExportingPdf(false);
    }
  }, [exportingPdf]);

  const goBackToCategories = useCallback(() => {
    setSelectedCategory(null);
    setSearch("");
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
        <p className="text-sm text-stone-500">載入合作KOL名單…</p>
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
      {isEmployee ? (
        <div className="border-b border-stone-200/90 bg-white/95 backdrop-blur-sm">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-2.5 sm:px-6">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Link href="/dashboard" className="font-semibold text-stone-600 hover:text-stone-900">
                ← 回後台
              </Link>
              <span className="text-stone-300">|</span>
              <span className="text-stone-500">內部預覽 · 此頁可分享給客戶瀏覽</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {selectedCategory ? (
                <button
                  type="button"
                  disabled={exportingPdf || visibleItems.length === 0}
                  onClick={() => void handleExportPdf()}
                  className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-stone-600 hover:bg-stone-50 disabled:opacity-50"
                >
                  {exportingPdf ? "PDF…" : "匯出 PDF"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void load()}
                className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-stone-600 hover:bg-stone-50"
              >
                重新整理
              </button>
            </div>
          </div>
          {exportPdfError ? (
            <p className="mx-auto max-w-7xl px-4 pb-2 text-xs text-red-700 sm:px-6">{exportPdfError}</p>
          ) : null}
        </div>
      ) : null}

      <main ref={catalogRef} className="pb-16">
        <header className="relative overflow-hidden border-b border-amber-200/40 bg-gradient-to-br from-[#fff9f0] via-white to-amber-50/60">
          <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-amber-200/30 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-16 left-10 h-48 w-48 rounded-full bg-stone-200/40 blur-3xl" />
          <div className="relative mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
            <Image src="/logo.png" alt="盛德好" width={200} height={48} className="h-10 w-auto object-contain sm:h-11" />
            <p className="mt-6 text-xs font-bold uppercase tracking-[0.25em] text-amber-800/70">Influencer Roster</p>
            <h1 className="mt-2 max-w-2xl text-3xl font-bold tracking-tight text-stone-900 sm:text-4xl lg:text-5xl">
              合作KOL名單
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-stone-600 sm:text-base">
              {selectedCategory
                ? `瀏覽「${selectedCategory}」領域的合作創作者`
                : "請先選擇領域分類，再瀏覽該類別的合作創作者"}
            </p>
            {!selectedCategory ? (
              <div className="mt-8 flex flex-wrap gap-3">
                <div className="rounded-2xl bg-white/90 px-5 py-3 shadow-sm ring-1 ring-stone-200/80">
                  <p className="text-2xl font-bold tabular-nums text-stone-900">{items.length}</p>
                  <p className="text-xs font-medium text-stone-500">合作 KOL</p>
                </div>
                <div className="rounded-2xl bg-white/90 px-5 py-3 shadow-sm ring-1 ring-stone-200/80">
                  <p className="text-2xl font-bold tabular-nums text-stone-900">{categoryTiles.length}</p>
                  <p className="text-xs font-medium text-stone-500">領域分類</p>
                </div>
              </div>
            ) : null}
          </div>
        </header>

        {!selectedCategory ? (
          /* —— 階段一：類別選擇 —— */
          <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
            <h2 className="mb-6 text-sm font-bold uppercase tracking-wide text-stone-500">選擇領域</h2>
            {categoryTiles.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-stone-300 bg-white/60 px-6 py-20 text-center">
                <p className="text-stone-600">目前尚無分類資料</p>
              </div>
            ) : (
              <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {categoryTiles.map((tile) => (
                  <button
                    key={tile.key}
                    type="button"
                    onClick={() => {
                      setSelectedCategory(tile.key);
                      setSearch("");
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                    className="group flex flex-col overflow-hidden rounded-2xl border border-stone-200/90 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-amber-300 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xl font-bold text-stone-900 group-hover:text-amber-900">{tile.label}</p>
                        <p className="mt-1 text-sm tabular-nums text-stone-500">{tile.count} 位創作者</p>
                      </div>
                      <span className="mt-1 text-amber-600 transition group-hover:translate-x-0.5" aria-hidden>
                        →
                      </span>
                    </div>
                    {tile.previewAvatars.length > 0 ? (
                      <div className="mt-5 flex -space-x-2">
                        {tile.previewAvatars.map((url, i) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={`${tile.key}-${i}`}
                            src={url}
                            alt=""
                            className="h-9 w-9 rounded-full border-2 border-white object-cover ring-1 ring-stone-200/80"
                          />
                        ))}
                        {tile.count > tile.previewAvatars.length ? (
                          <span className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-white bg-stone-100 text-[10px] font-bold text-stone-600 ring-1 ring-stone-200/80">
                            +{tile.count - tile.previewAvatars.length}
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <div className="mt-5 h-9 rounded-full bg-gradient-to-r from-amber-50 to-stone-100 ring-1 ring-stone-100" />
                    )}
                  </button>
                ))}
              </section>
            )}
          </div>
        ) : (
          /* —— 階段二：該類別 KOL —— */
          <>
            <div className="sticky top-0 z-10 border-b border-stone-200/80 bg-[#f6f3ee]/95 backdrop-blur-md">
              <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-4 sm:px-6">
                <button
                  type="button"
                  onClick={goBackToCategories}
                  className="inline-flex shrink-0 items-center gap-1 rounded-full border border-stone-300 bg-white px-3.5 py-1.5 text-sm font-semibold text-stone-700 shadow-sm hover:bg-stone-50"
                >
                  ← 全部類別
                </button>
                <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-bold text-amber-950 ring-1 ring-amber-200/80">
                  {selectedCategory}
                </span>
                <label className="min-w-[12rem] flex-1">
                  <span className="sr-only">搜尋此類別 KOL</span>
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="在此類別搜尋名稱、頻道…"
                    className="w-full rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm shadow-sm outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-200"
                  />
                </label>
              </div>
            </div>

            <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
              <p className="mb-6 text-sm text-stone-500">
                顯示 <span className="font-semibold text-stone-800">{visibleItems.length}</span> 位 · {selectedCategory}
                {search.trim() ? ` · 搜尋「${search.trim()}」` : ""}
              </p>

              {visibleItems.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-stone-300 bg-white/60 px-6 py-20 text-center">
                  <p className="text-stone-600">此類別找不到符合條件的 KOL</p>
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="mt-3 text-sm font-semibold text-amber-800 hover:underline"
                  >
                    清除搜尋
                  </button>
                </div>
              ) : (
                <section className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {visibleItems.map((item) => (
                    <KolCatalogCard key={item.id} item={item} />
                  ))}
                </section>
              )}
            </div>
          </>
        )}

        <footer className="border-t border-stone-200/80 bg-white/50">
          <div className="mx-auto max-w-7xl px-4 py-8 text-center sm:px-6">
            <p className="text-sm font-semibold text-stone-800">盛德好股份有限公司</p>
            <p className="mt-1 text-xs text-stone-500">本頁面僅供合作提案參考 · 資料依合作夥伴主檔即時更新</p>
          </div>
        </footer>
      </main>
    </>
  );
}
