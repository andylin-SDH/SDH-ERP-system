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

function LaborReceiptsInner() {
  const sp = useSearchParams();
  const 專案ID = String(sp.get("專案ID") ?? "").trim();
  const [receipt, setReceipt] = useState<LaborReceiptExport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const printRootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!專案ID) {
      setError("缺少專案ID");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/kol-labor-receipts?專案ID=${encodeURIComponent(專案ID)}`, {
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
        setReceipt(null);
        return;
      }
      setReceipt(data.receipt);
    } catch (e) {
      setError(e instanceof Error ? e.message : "讀取失敗");
      setReceipt(null);
    } finally {
      setLoading(false);
    }
  }, [專案ID]);

  useEffect(() => {
    void load();
  }, [load]);

  const pages = useMemo(() => (receipt ? chunkPairs(receipt.單據) : []), [receipt]);

  async function handleDownloadPdf() {
    if (!printRootRef.current || !receipt) return;
    setExporting(true);
    setExportError(null);
    try {
      await exportLaborReceiptsPdf(
        printRootRef.current,
        laborReceiptPdfFilename(receipt.KOL名稱, receipt.專案ID)
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "PDF 下載失敗";
      setExportError(`${msg}（可改用「列印 → 另存為 PDF」）`);
      window.alert(`${msg}\n\n可改用「列印」→ 另存為 PDF。`);
    } finally {
      setExporting(false);
    }
  }

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
            <h1 className="text-base font-bold">勞務報酬收據</h1>
            {receipt ? (
              <p className="text-xs text-stone-500">
                {receipt.KOL名稱} · {receipt.專案名稱} · {receipt.單據.length} 張（兩份一頁 A4；每頁僅上半張附身分證）
              </p>
            ) : (
              <p className="text-xs text-stone-500">{專案ID || "—"}</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => window.close()}
              className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-semibold text-stone-700 hover:bg-stone-50"
            >
              關閉
            </button>
            <button
              type="button"
              disabled={!receipt || exporting}
              onClick={() => window.print()}
              className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-50"
            >
              列印
            </button>
            <button
              type="button"
              disabled={!receipt || exporting}
              onClick={() => void handleDownloadPdf()}
              className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-bold text-slate-900 hover:bg-amber-400 disabled:opacity-50"
            >
              {exporting ? "產生中…" : "下載 PDF"}
            </button>
          </div>
        </div>
        {exportError ? (
          <p className="mx-auto mt-2 max-w-4xl text-xs font-medium text-red-700">{exportError}</p>
        ) : null}
      </header>

      <main className="mx-auto max-w-4xl px-3 py-6">
        {loading ? (
          <p className="rounded-xl bg-white px-4 py-10 text-center text-sm text-stone-500">載入中…</p>
        ) : error ? (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-center text-sm text-red-800">
            {error}
          </p>
        ) : receipt ? (
          <div ref={printRootRef}>
            {pages.map((pair, pageIdx) => (
              <div
                key={`page-${pageIdx}`}
                className="labor-receipt-a4-page overflow-hidden bg-white"
                style={{ width: "210mm", maxWidth: "100%", minHeight: "297mm" }}
              >
                {pair.map((slip, slotIdx) => {
                  const globalIdx = pageIdx * 2 + slotIdx;
                  const isFirstOnPage = slotIdx === 0;
                  const hasPair = pair.length === 2;
                  return (
                    <KolLaborReceiptPreview
                      key={`${slip.序號}-${globalIdx}`}
                      recipientName={receipt.KOL名稱}
                      receiptDate={receipt.收據日期}
                      paymentMethod={receipt.領款方式}
                      grossAmount={slip.應領金額}
                      taxWithheld={slip.扣繳稅額}
                      nhiWithheld={slip.二代健保費}
                      netAmount={slip.實領金額}
                      idNumber={receipt.身分證字號}
                      phone={receipt.聯絡電話}
                      address={receipt.戶籍地址}
                      laborContent={receipt.勞務內容 || slip.備註}
                      note={slip.備註}
                      signatureDataUrl={receipt.勞報簽名}
                      idCardFrontUrl={receipt.身分證正面}
                      idCardBackUrl={receipt.身分證反面}
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
