"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchSessionWithRetry } from "@/components/ErpLoginPanel";
import { SocialLinkIcons } from "@/components/SocialLinkIcons";
import {
  catalogCategoryTabs,
  resolveCategoryCoverAvatars,
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

/** 數字載入時由 0 平滑遞增 */
function CountUp({
  value,
  durationMs = 900,
  className = "",
}: {
  value: number;
  durationMs?: number;
  className?: string;
}) {
  const target = Math.max(0, Math.round(Number(value) || 0));
  const [display, setDisplay] = useState(0);
  const reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

  useEffect(() => {
    if (reducedMotion || target === 0) {
      setDisplay(target);
      return;
    }
    setDisplay(0);
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(target * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs, reducedMotion]);

  return <span className={className}>{display.toLocaleString("zh-TW")}</span>;
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
  previewNames: string[];
  tagline: string;
};

function buildCategoryTiles(
  items: KolCatalogItem[],
  categoryCovers: Record<string, string[]>
): CategoryTile[] {
  const tabs = catalogCategoryTabs(items).filter((t) => t.key !== "all");
  return tabs.map((tab) => {
    const inCat = items.filter((i) => (i.category1 || "未分類") === tab.key);
    const preferred = categoryCovers[tab.key] ?? [];
    const previewAvatars = resolveCategoryCoverAvatars(items, tab.key, preferred);
    const preferredNames = preferred
      .map((id) => inCat.find((i) => i.id === id)?.name)
      .filter((n): n is string => Boolean(n));
    const previewNames =
      preferredNames.length > 0
        ? [...preferredNames, ...inCat.map((i) => i.name).filter((n) => !preferredNames.includes(n))].slice(0, 3)
        : inCat.map((i) => i.name).filter(Boolean).slice(0, 3);
    const cat2Counts = new Map<string, number>();
    for (const i of inCat) {
      const c2 = i.category2.trim();
      if (!c2) continue;
      cat2Counts.set(c2, (cat2Counts.get(c2) ?? 0) + 1);
    }
    const topTags = [...cat2Counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-TW"))
      .slice(0, 2)
      .map(([k]) => k);
    const tagline =
      topTags.length > 0
        ? topTags.join(" · ")
        : previewNames.length > 0
          ? `代表：${previewNames.slice(0, 2).join("、")}`
          : "點擊瀏覽此領域創作者";
    return {
      key: tab.key,
      label: tab.label,
      count: tab.count,
      previewAvatars,
      previewNames,
      tagline,
    };
  });
}

function CategoryDirectoryCard({
  tile,
  index,
  onSelect,
  canEditCover,
  onEditCover,
}: {
  tile: CategoryTile;
  index: number;
  onSelect: () => void;
  canEditCover?: boolean;
  onEditCover?: () => void;
}) {
  const covers = tile.previewAvatars.slice(0, 3);
  const coverA = covers[0];
  const coverB = covers[1];
  const coverC = covers[2];

  return (
    <div className="kol-cat-card relative" style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}>
      <button
        type="button"
        onClick={onSelect}
        className="group relative flex min-h-[220px] w-full flex-col overflow-hidden rounded-2xl border border-stone-900/10 text-left shadow-md outline-none transition duration-300 hover:-translate-y-1 hover:shadow-xl focus-visible:ring-2 focus-visible:ring-amber-400 sm:min-h-[240px]"
      >
        <div className="absolute inset-0 bg-stone-800" aria-hidden>
          {covers.length >= 3 ? (
            <div className="grid h-full grid-cols-[1.35fr_1fr] grid-rows-2 gap-0.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={coverA} alt="" className="row-span-2 h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={coverB} alt="" className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={coverC} alt="" className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]" />
            </div>
          ) : covers.length === 2 ? (
            <div className="grid h-full grid-cols-2 gap-0.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={coverA} alt="" className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={coverB} alt="" className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]" />
            </div>
          ) : coverA ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={coverA} alt="" className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.05]" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-stone-700 via-stone-800 to-amber-950/80 text-6xl font-bold text-white/25">
              {tile.label.charAt(0)}
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/55 to-black/25 transition duration-300 group-hover:from-black/95 group-hover:via-black/65" />
        </div>

        <div className="relative z-10 flex flex-1 flex-col justify-between px-5 pb-3 pt-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="kol-cat-title text-[1.85rem] font-black leading-[1.15] tracking-tight text-white sm:text-[2.15rem]">
                {tile.label}
              </p>
              <p className="mt-2 text-sm font-semibold tabular-nums text-white/90 sm:text-base">
                {tile.count} 位創作者
              </p>
            </div>
            <span
              className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/30 bg-white/10 text-sm text-white backdrop-blur-sm transition duration-300 group-hover:translate-x-0.5 group-hover:border-amber-200/60 group-hover:bg-amber-400/90 group-hover:text-stone-900"
              aria-hidden
            >
              →
            </span>
          </div>
        </div>

        <div className="kol-cat-reveal relative z-10">
          <div className="kol-cat-reveal-inner space-y-2.5 border-t border-white/15 bg-black/35 px-5 pb-5 pt-3 backdrop-blur-md">
            {tile.previewAvatars.length > 0 ? (
              <div className="flex items-center">
                <div className="flex -space-x-2">
                  {tile.previewAvatars.map((url, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={`${tile.key}-av-${i}`} src={url} alt="" className="h-8 w-8 rounded-full border-2 border-white/90 object-cover shadow-sm" />
                  ))}
                </div>
                {tile.count > tile.previewAvatars.length ? (
                  <span className="ml-2 text-xs font-semibold tabular-nums text-white/70">
                    +{tile.count - tile.previewAvatars.length}
                  </span>
                ) : null}
              </div>
            ) : null}

            {tile.previewNames.length > 0 ? (
              <p className="line-clamp-1 text-sm font-medium text-white/95">
                {tile.previewNames.join("、")}
                {tile.count > tile.previewNames.length ? "…" : ""}
              </p>
            ) : null}

            <p className="line-clamp-1 text-xs text-white/65">{tile.tagline}</p>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-amber-200/90">點擊進入目錄</p>
          </div>
        </div>
      </button>

      {canEditCover && onEditCover ? (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onEditCover();
          }}
          className="absolute right-3 top-3 z-20 rounded-full border border-white/40 bg-black/60 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur-sm hover:bg-amber-400 hover:text-stone-900"
        >
          設定封面
        </button>
      ) : null}
    </div>
  );
}

export default function KolCatalogPage() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [items, setItems] = useState<KolCatalogItem[]>([]);
  const [categoryCovers, setCategoryCovers] = useState<Record<string, string[]>>({});
  /** null = 類別選擇首頁；字串 = 已選類別 */
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [isEmployee, setIsEmployee] = useState(false);
  const [canEditCovers, setCanEditCovers] = useState(false);
  const [coverEditorCategory, setCoverEditorCategory] = useState<string | null>(null);
  const [coverDraftIds, setCoverDraftIds] = useState<string[]>([]);
  const [coverSaving, setCoverSaving] = useState(false);
  const [coverSaveError, setCoverSaveError] = useState<string | null>(null);
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
      categoryCovers?: Record<string, string[]>;
      error?: string;
    };
    if (!res.ok || !data.ok) {
      setLoadError(data.error ?? "無法載入 KOL 名單");
      setLoading(false);
      return;
    }
    setItems(Array.isArray(data.items) ? data.items : []);
    setCategoryCovers(
      data.categoryCovers && typeof data.categoryCovers === "object" ? data.categoryCovers : {}
    );
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
        const role = String(sess.user.role ?? "").trim();
        setCanEditCovers(role === "董事長" || role === "管理者");
      }
    })();
  }, []);

  const categoryTiles = useMemo(
    () => buildCategoryTiles(items, categoryCovers),
    [items, categoryCovers]
  );

  const coverEditorCandidates = useMemo(() => {
    if (!coverEditorCategory) return [];
    return items
      .filter((i) => (i.category1 || "未分類") === coverEditorCategory)
      .sort((a, b) => {
        const av = a.avatarUrl ? 0 : 1;
        const bv = b.avatarUrl ? 0 : 1;
        return av - bv || a.name.localeCompare(b.name, "zh-TW");
      });
  }, [items, coverEditorCategory]);

  const openCoverEditor = useCallback(
    (categoryKey: string) => {
      const current = categoryCovers[categoryKey] ?? [];
      setCoverDraftIds(current.slice(0, 3));
      setCoverSaveError(null);
      setCoverEditorCategory(categoryKey);
    },
    [categoryCovers]
  );

  const toggleCoverDraft = useCallback((partnerId: string) => {
    setCoverDraftIds((prev) => {
      if (prev.includes(partnerId)) return prev.filter((id) => id !== partnerId);
      if (prev.length >= 3) return [...prev.slice(1), partnerId];
      return [...prev, partnerId];
    });
  }, []);

  const saveCoverSelection = useCallback(async () => {
    if (!coverEditorCategory) return;
    setCoverSaving(true);
    setCoverSaveError(null);
    const next = { ...categoryCovers };
    if (coverDraftIds.length === 0) delete next[coverEditorCategory];
    else next[coverEditorCategory] = coverDraftIds.slice(0, 3);
    try {
      const res = await fetch("/api/system-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "kol_catalog_category_covers", value: next }),
      });
      const data = (await safeResJson(res)) as {
        ok?: boolean;
        error?: string;
        config?: { kol_catalog_category_covers?: Record<string, string[]> };
      };
      if (!res.ok || !data.ok) {
        setCoverSaveError(data.error ?? "儲存失敗（需董事長／管理者）");
        return;
      }
      setCategoryCovers(data.config?.kol_catalog_category_covers ?? next);
      setCoverEditorCategory(null);
    } catch (e) {
      setCoverSaveError(e instanceof Error ? e.message : "儲存失敗");
    } finally {
      setCoverSaving(false);
    }
  }, [categoryCovers, coverDraftIds, coverEditorCategory]);

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
          <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between lg:gap-10">
              <div className="min-w-0 flex-1">
                <Image
                  src="/logo.png"
                  alt="盛德好"
                  width={200}
                  height={48}
                  className="h-10 w-auto object-contain sm:h-11"
                  priority
                />
                <p className="mt-5 text-xs font-bold uppercase tracking-[0.25em] text-amber-800/70">
                  Influencer Roster
                </p>
                <h1 className="mt-2 text-3xl font-bold tracking-tight text-stone-900 sm:text-4xl">
                  合作KOL名單
                </h1>
              </div>

              <div className="flex shrink-0 flex-wrap gap-3 lg:justify-end">
                <div className="min-w-[8.5rem] rounded-2xl bg-white/90 px-5 py-3 shadow-sm ring-1 ring-stone-200/80">
                  <p className="text-2xl font-bold tabular-nums text-stone-900 sm:text-3xl">
                    <CountUp
                      value={
                        selectedCategory
                          ? items.filter((i) => (i.category1 || "未分類") === selectedCategory)
                              .length
                          : items.length
                      }
                    />
                  </p>
                  <p className="text-xs font-medium text-stone-500">
                    {selectedCategory ? "此領域 KOL" : "合作 KOL"}
                  </p>
                </div>
                {!selectedCategory ? (
                  <div className="min-w-[8.5rem] rounded-2xl bg-white/90 px-5 py-3 shadow-sm ring-1 ring-stone-200/80">
                    <p className="text-2xl font-bold tabular-nums text-stone-900 sm:text-3xl">
                      <CountUp value={categoryTiles.length} durationMs={750} />
                    </p>
                    <p className="text-xs font-medium text-stone-500">領域分類</p>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </header>

        {!selectedCategory ? (
          /* —— 階段一：類別選擇 —— */
          <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
            <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold uppercase tracking-[0.18em] text-stone-500">選擇領域</h2>
                <p className="mt-1 text-sm text-stone-500">封面預覽創作者；滑過展開名單，點擊進入目錄</p>
              </div>
            </div>
            {categoryTiles.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-stone-300 bg-white/60 px-6 py-20 text-center">
                <p className="text-stone-600">目前尚無分類資料</p>
              </div>
            ) : (
              <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 sm:gap-4">
                {categoryTiles.map((tile, index) => (
                  <CategoryDirectoryCard
                    key={tile.key}
                    tile={tile}
                    index={index}
                    canEditCover={canEditCovers}
                    onEditCover={() => openCoverEditor(tile.key)}
                    onSelect={() => {
                      setSelectedCategory(tile.key);
                      setSearch("");
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                  />
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

      {coverEditorCategory ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/50 p-4 backdrop-blur-sm sm:items-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="cover-editor-title"
            className="max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl"
          >
            <header className="flex items-start justify-between gap-3 border-b border-stone-200 px-5 py-4">
              <div>
                <h3 id="cover-editor-title" className="text-lg font-bold text-stone-900">
                  設定「{coverEditorCategory}」封面
                </h3>
                <p className="mt-1 text-xs text-stone-500">
                  最多選 3 位（有形象照較佳）；點選順序即封面排列。清空則改回自動挑選。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCoverEditorCategory(null)}
                className="rounded-lg border border-stone-300 px-2.5 py-1 text-sm font-semibold text-stone-600 hover:bg-stone-50"
              >
                關閉
              </button>
            </header>

            <div className="max-h-[50vh] space-y-2 overflow-y-auto px-5 py-4">
              {coverEditorCandidates.length === 0 ? (
                <p className="py-8 text-center text-sm text-stone-500">此分類尚無 KOL</p>
              ) : (
                coverEditorCandidates.map((item) => {
                  const selected = coverDraftIds.includes(item.id);
                  const order = selected ? coverDraftIds.indexOf(item.id) + 1 : null;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => toggleCoverDraft(item.id)}
                      className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                        selected
                          ? "border-amber-400 bg-amber-50 ring-1 ring-amber-300"
                          : "border-stone-200 bg-white hover:border-stone-300"
                      }`}
                    >
                      {item.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.avatarUrl} alt="" className="h-12 w-12 rounded-lg object-cover" />
                      ) : (
                        <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-stone-100 text-sm font-bold text-stone-400">
                          {item.name.charAt(0)}
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-stone-900">{item.name}</p>
                        <p className="truncate text-xs text-stone-500">
                          {item.channelName || item.id}
                          {!item.avatarUrl ? " · 無形象照" : ""}
                        </p>
                      </div>
                      <span
                        className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                          selected ? "bg-amber-500 text-stone-900" : "bg-stone-100 text-stone-400"
                        }`}
                      >
                        {order ?? "＋"}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-stone-200 px-5 py-4">
              <button
                type="button"
                onClick={() => setCoverDraftIds([])}
                className="text-sm font-semibold text-stone-500 hover:text-stone-800"
              >
                清空（改自動）
              </button>
              <div className="flex flex-wrap items-center gap-2">
                {coverSaveError ? (
                  <p className="text-xs font-medium text-red-700">{coverSaveError}</p>
                ) : null}
                <button
                  type="button"
                  disabled={coverSaving}
                  onClick={() => void saveCoverSelection()}
                  className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-slate-900 hover:bg-amber-400 disabled:opacity-60"
                >
                  {coverSaving ? "儲存中…" : "儲存封面"}
                </button>
              </div>
            </footer>
          </div>
        </div>
      ) : null}
    </>
  );
}
