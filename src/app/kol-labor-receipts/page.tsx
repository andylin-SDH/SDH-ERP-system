"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { KolLaborReceiptPreview } from "@/components/KolLaborReceiptPreview";
import {
  exportLaborReceiptsPdf,
  laborReceiptPdfFilename,
} from "@/lib/kol/export-labor-receipt-pdf";
import type { LaborReceiptExport } from "@/lib/db/kol-labor-receipts";

async function safeResJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

function chunkPairs<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += 2) {
    out.push(items.slice(i, i + 2));
  }
  return out;
}

function parseIdsFromSearch(sp: URLSearchParams): string[] {
  const multi = String(sp.get("專案IDs") ?? "").trim();
  if (multi) {
    return [...new Set(multi.split(",").map((s) => s.trim()).filter(Boolean))];
  }
  const one = String(sp.get("專案ID") ?? "").trim();
  return one ? [one] : [];
}

async function markLaborDownloaded(projectIds: string[]): Promise<void> {
  const ids = [...new Set(projectIds.map((p) => String(p ?? "").trim()).filter(Boolean))];
  if (ids.length === 0) return;
  try {
    await fetch("/api/kol-labor-receipts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ 專案IDs: ids }),
    });
  } catch {
    /* 注記失敗不阻斷下載 */
  }
}

function LaborReceiptsInner() {
  const sp = useSearchParams();
  const projectIds = useMemo(() => parseIdsFromSearch(sp), [sp]);
  const isBatch = projectIds.length > 1;

  const [receipts, setReceipts] = useState<LaborReceiptExport[]>([]);
  const [loadErrors, setLoadErrors] = useState<Array<{ 專案ID: string; error: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number; current: string } | null>(
    null
  );
  const [activeReceipt, setActiveReceipt] = useState<LaborReceiptExport | null>(null);
  const printRootRef = useRef<HTMLDivElement>(null);
  const batchAutoStartedRef = useRef(false);

  const load = useCallback(async () => {
    if (projectIds.length === 0) {
      setError("缺少專案ID");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setLoadErrors([]);
    try {
      if (projectIds.length === 1) {
        const res = await fetch(`/api/kol-labor-receipts?專案ID=${encodeURIComponent(projectIds[0]!)}`, {
          cache: "no-store",
          credentials: "include",
        });
        const data = (await safeResJson(res)) as {
          ok?: boolean;
          error?: string;
          receipt?: LaborReceiptExport;
        };
        if (!res.ok || !data.ok || !data.receipt) {
          setError(data.error ?? "讀取勞報收據失敗");
          setReceipts([]);
          setActiveReceipt(null);
          return;
        }
        setReceipts([data.receipt]);
        setActiveReceipt(data.receipt);
        return;
      }

      const res = await fetch(
        `/api/kol-labor-receipts?專案IDs=${encodeURIComponent(projectIds.join(","))}`,
        { cache: "no-store", credentials: "include" }
      );
      const data = (await safeResJson(res)) as {
        ok?: boolean;
        error?: string;
        receipts?: LaborReceiptExport[];
        errors?: Array<{ 專案ID: string; error: string }>;
      };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "批次讀取勞報失敗");
        setReceipts([]);
        setActiveReceipt(null);
        return;
      }
      const list = Array.isArray(data.receipts) ? data.receipts : [];
      setReceipts(list);
      setLoadErrors(Array.isArray(data.errors) ? data.errors : []);
      setActiveReceipt(list[0] ?? null);
      if (list.length === 0) {
        setError("沒有可下載的勞報收據");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "讀取失敗");
      setReceipts([]);
      setActiveReceipt(null);
    } finally {
      setLoading(false);
    }
  }, [projectIds]);

  useEffect(() => {
    void load();
  }, [load]);

  const pages = useMemo(
    () => (activeReceipt ? chunkPairs(activeReceipt.單據) : []),
    [activeReceipt]
  );

  const waitForPaint = () =>
    new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          window.setTimeout(() => resolve(), 80);
        });
      });
    });

  const exportOne = async (receipt: LaborReceiptExport) => {
    setActiveReceipt(receipt);
    await waitForPaint();
    if (!printRootRef.current) throw new Error("預覽尚未就緒");
    await exportLaborReceiptsPdf(
      printRootRef.current,
      laborReceiptPdfFilename(receipt.KOL名稱, receipt.專案ID)
    );
    await markLaborDownloaded([receipt.專案ID]);
  };

  async function handleDownloadPdf() {
    if (!activeReceipt) return;
    setExporting(true);
    setExportError(null);
    try {
      await exportOne(activeReceipt);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "PDF 下載失敗";
      setExportError(`${msg}（可改用「列印 → 另存為 PDF」）`);
      window.alert(`${msg}\n\n可改用「列印」→ 另存為 PDF。`);
    } finally {
      setExporting(false);
    }
  }

  async function handleBatchDownloadAll() {
    if (receipts.length === 0) return;
    setExporting(true);
    setExportError(null);
    const failed: string[] = [];
    try {
      for (let i = 0; i < receipts.length; i++) {
        const r = receipts[i]!;
        setBatchProgress({
          done: i,
          total: receipts.length,
          current: `${r.KOL名稱} · ${r.專案名稱}`,
        });
        try {
          await exportOne(r);
        } catch (e) {
          failed.push(`${r.專案ID}：${e instanceof Error ? e.message : "失敗"}`);
        }
      }
      setBatchProgress({ done: receipts.length, total: receipts.length, current: "完成" });
      if (failed.length > 0) {
        setExportError(`部分失敗：${failed.join("；")}`);
        window.alert(`已下載 ${receipts.length - failed.length}／${receipts.length} 筆。\n\n失敗：\n${failed.join("\n")}`);
      }
    } finally {
      setExporting(false);
    }
  }

  useEffect(() => {
    if (!isBatch || loading || receipts.length === 0 || batchAutoStartedRef.current) return;
    batchAutoStartedRef.current = true;
    void handleBatchDownloadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 僅在批次資料就緒時自動跑一次
  }, [isBatch, loading, receipts.length]);

  return (
    <div className="min-h-screen bg-stone-200 text-stone-900">
      <style>{`
        @media print {
          @page { size: A4; margin: 0; }
          body { background: white !important; margin: 0; }
          .no-print { display: none !important; }
          .labor-receipt-a4-page {
            page-break-after: always;
            break-after: page;
            box-shadow: none !important;
            margin: 0 !important;
          }
          .labor-receipt-a4-page:last-child {
            page-break-after: auto;
            break-after: auto;
          }
          .labor-receipt-sheet { box-shadow: none !important; margin: 0 !important; }
          .labor-receipt-cut { border-color: #a8a29e !important; }
        }
        @media screen {
          .labor-receipt-a4-page {
            box-shadow: 0 8px 24px rgba(0,0,0,.12);
            margin-bottom: 16px;
          }
        }
      `}</style>

      <header className="no-print sticky top-0 z-10 border-b border-stone-300 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-base font-bold">
              {isBatch ? `批次勞務報酬收據（${receipts.length || projectIds.length} 筆）` : "勞務報酬收據"}
            </h1>
            {activeReceipt ? (
              <p className="text-xs text-stone-500">
                {activeReceipt.KOL名稱} · {activeReceipt.專案名稱} · {activeReceipt.單據.length} 張（兩份一頁 A4）
              </p>
            ) : (
              <p className="text-xs text-stone-500">{projectIds.join("、") || "—"}</p>
            )}
            {batchProgress ? (
              <p className="mt-0.5 text-xs font-semibold text-amber-800">
                下載進度 {batchProgress.done}/{batchProgress.total}
                {batchProgress.current ? ` · ${batchProgress.current}` : ""}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => window.close()}
              className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-semibold text-stone-700 hover:bg-stone-50"
            >
              關閉
            </button>
            {!isBatch ? (
              <>
                <button
                  type="button"
                  disabled={!activeReceipt || exporting}
                  onClick={() => window.print()}
                  className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-50"
                >
                  列印
                </button>
                <button
                  type="button"
                  disabled={!activeReceipt || exporting}
                  onClick={() => void handleDownloadPdf()}
                  className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-bold text-slate-900 hover:bg-amber-400 disabled:opacity-50"
                >
                  {exporting ? "產生中…" : "下載 PDF"}
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={receipts.length === 0 || exporting}
                onClick={() => void handleBatchDownloadAll()}
                className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-bold text-slate-900 hover:bg-amber-400 disabled:opacity-50"
              >
                {exporting ? "批次下載中…" : "重新批次下載 PDF"}
              </button>
            )}
          </div>
        </div>
        {exportError ? (
          <p className="mx-auto mt-2 max-w-4xl text-xs font-medium text-red-700">{exportError}</p>
        ) : null}
        {loadErrors.length > 0 ? (
          <p className="mx-auto mt-2 max-w-4xl text-xs font-medium text-amber-800">
            略過 {loadErrors.length} 筆：
            {loadErrors.map((e) => `${e.專案ID}（${e.error}）`).join("；")}
          </p>
        ) : null}
      </header>

      <main className="mx-auto max-w-4xl px-3 py-6">
        {loading ? (
          <p className="rounded-xl bg-white px-4 py-10 text-center text-sm text-stone-500">載入中…</p>
        ) : error ? (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-center text-sm text-red-800">
            {error}
          </p>
        ) : activeReceipt ? (
          <div ref={printRootRef}>
            {pages.map((pair, pageIdx) => (
              <div
                key={`${activeReceipt.專案ID}-page-${pageIdx}`}
                className="labor-receipt-a4-page overflow-hidden bg-white"
                style={{ width: "210mm", maxWidth: "100%", minHeight: "297mm" }}
              >
                {pair.map((slip, slotIdx) => {
                  const globalIdx = pageIdx * 2 + slotIdx;
                  const isFirstOnPage = slotIdx === 0;
                  const hasPair = pair.length === 2;
                  return (
                    <KolLaborReceiptPreview
                      key={`${activeReceipt.專案ID}-${slip.序號}-${globalIdx}`}
                      recipientName={activeReceipt.KOL名稱}
                      receiptDate={activeReceipt.收據日期}
                      paymentMethod={activeReceipt.領款方式}
                      grossAmount={slip.應領金額}
                      taxWithheld={slip.扣繳稅額}
                      nhiWithheld={slip.二代健保費}
                      netAmount={slip.實領金額}
                      idNumber={activeReceipt.身分證字號}
                      phone={activeReceipt.聯絡電話}
                      address={activeReceipt.戶籍地址}
                      laborContent={activeReceipt.勞務內容 || slip.備註}
                      note={slip.備註}
                      signatureDataUrl={activeReceipt.勞報簽名}
                      idCardFrontUrl={activeReceipt.身分證正面}
                      idCardBackUrl={activeReceipt.身分證反面}
                      showIdCards={isFirstOnPage}
                      compact
                      className={
                        isFirstOnPage && hasPair
                          ? "labor-receipt-cut border-b border-dashed border-stone-400"
                          : ""
                      }
                    />
                  );
                })}
              </div>
            ))}
          </div>
        ) : null}
      </main>
    </div>
  );
}

export default function KolLaborReceiptsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-stone-100 text-sm text-stone-500">
          載入中…
        </div>
      }
    >
      <LaborReceiptsInner />
    </Suspense>
  );
}
