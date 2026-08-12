"use client";

import {
  calcLaborWithholding,
  formatRocDate,
  formatTwdChineseUpper,
  SDH_LABOR_RECEIPT_COMPANY,
  SDH_LABOR_RECEIPT_FOOTNOTE,
  type LaborPaymentMethod,
} from "@/lib/kol/labor-receipt";

export type KolLaborReceiptPreviewProps = {
  recipientName: string;
  receiptDate?: string;
  paymentMethod: LaborPaymentMethod;
  /** 應領金額；若有提供已存的扣繳／實領則優先使用 */
  grossAmount: string | number;
  taxWithheld?: string | number | null;
  nhiWithheld?: string | number | null;
  netAmount?: string | number | null;
  idNumber: string;
  phone: string;
  address: string;
  laborContent: string;
  note?: string;
  signatureDataUrl?: string | null;
  idCardFrontUrl?: string | null;
  idCardBackUrl?: string | null;
  /** 列印時每張單據分頁 */
  pageBreakAfter?: boolean;
  className?: string;
};

function toMoney(raw: string | number | null | undefined): number {
  const n = typeof raw === "number" ? raw : parseFloat(String(raw ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

export function KolLaborReceiptPreview({
  recipientName,
  receiptDate,
  paymentMethod,
  grossAmount,
  taxWithheld,
  nhiWithheld,
  netAmount,
  idNumber,
  phone,
  address,
  laborContent,
  note,
  signatureDataUrl,
  idCardFrontUrl,
  idCardBackUrl,
  pageBreakAfter = false,
  className = "",
}: KolLaborReceiptPreviewProps) {
  const roc = formatRocDate(receiptDate);
  const computed = calcLaborWithholding(grossAmount);
  const 應領金額 = toMoney(grossAmount) || computed.應領金額;
  const hasStoredTax = taxWithheld != null && String(taxWithheld).trim() !== "";
  const hasStoredNhi = nhiWithheld != null && String(nhiWithheld).trim() !== "";
  const 扣繳稅額 = hasStoredTax ? toMoney(taxWithheld) : computed.扣繳稅額;
  const 二代健保費 = hasStoredNhi ? toMoney(nhiWithheld) : computed.二代健保費;
  const 應扣繳 = 扣繳稅額 > 0 || 二代健保費 > 0 || computed.應扣繳;
  const 實領金額 = toMoney(netAmount) || Math.max(0, 應領金額 - 扣繳稅額 - 二代健保費);
  const upper = formatTwdChineseUpper(應領金額);
  const sig = String(signatureDataUrl ?? "").trim();

  return (
    <div
      className={`labor-receipt-sheet bg-white text-stone-900 ${pageBreakAfter ? "labor-receipt-page-break" : ""} ${className}`}
      style={{
        width: "210mm",
        maxWidth: "100%",
        minHeight: "140mm",
        padding: "12mm 14mm",
        boxSizing: "border-box",
        fontFamily: '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif',
      }}
    >
      <p className="text-center text-[18px] font-bold tracking-wide">{SDH_LABOR_RECEIPT_COMPANY}</p>
      <p className="mt-1 text-center text-[20px] font-bold tracking-[0.35em]">勞務報酬收據</p>
      <p className="mt-3 text-right text-[13px] tabular-nums">
        {roc.year}年　{roc.month}　月　{roc.day}　日
      </p>

      <table className="mt-3 w-full border-collapse border border-stone-800 text-[13px]" style={{ tableLayout: "fixed" }}>
        <tbody>
          <tr>
            <td colSpan={4} className="border border-stone-800 px-2 py-2.5 align-middle">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="shrink-0 font-semibold">茲收到</span>
                <span className="inline-flex gap-3">
                  <span>{paymentMethod === "現金" ? "☑" : "□"} 現金</span>
                  <span>{paymentMethod === "匯款" ? "☑" : "□"} 匯款</span>
                </span>
                <span className="shrink-0">新台幣(大寫)：</span>
                <span className="min-w-[10rem] flex-1 border-b border-stone-500 font-semibold">
                  {upper || "\u00a0"}
                </span>
                <span className="shrink-0">元</span>
                <span className="shrink-0">（NT$）：</span>
                <span className="min-w-[5rem] border-b border-stone-500 font-semibold tabular-nums">
                  {應領金額 > 0 ? 應領金額.toLocaleString("zh-TW") : "\u00a0"}
                </span>
              </div>
            </td>
          </tr>

          <tr>
            <td className="w-[18%] border border-stone-800 bg-stone-50 px-2 py-2 text-center font-semibold">
              應領金額
            </td>
            <td className="w-[32%] border border-stone-800 px-2 py-2 text-right text-base font-bold tabular-nums">
              {應領金額 > 0 ? 應領金額.toLocaleString("zh-TW") : ""}
            </td>
            <td className="w-[18%] border border-stone-800 bg-stone-50 px-2 py-2 text-center font-semibold">
              領款人
            </td>
            <td className="w-[32%] border border-stone-800 px-2 py-2 align-top">
              <div className="flex min-h-[3.5rem] items-end justify-between gap-2">
                <div>
                  <p className="font-semibold">{recipientName || "\u00a0"}</p>
                  {sig.startsWith("data:image") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={sig} alt="簽名" className="mt-1 h-10 max-w-[9rem] object-contain" />
                  ) : null}
                </div>
                <span className="shrink-0 text-[11px] text-stone-500">（簽章）</span>
              </div>
            </td>
          </tr>

          <tr>
            <td className="border border-stone-800 bg-stone-50 px-2 py-2 text-center font-semibold leading-snug">
              實扣稅款
              <br />
              <span className="text-[11px] font-normal">各類所得（10%）</span>
            </td>
            <td className="border border-stone-800 px-2 py-2 text-center text-base font-semibold tabular-nums">
              {應扣繳 && 扣繳稅額 > 0 ? `-${扣繳稅額.toLocaleString("zh-TW")}` : "Ｘ"}
            </td>
            <td className="border border-stone-800 bg-stone-50 px-2 py-2 text-center font-semibold">
              身分證字號
            </td>
            <td className="border border-stone-800 px-2 py-2 font-mono font-semibold tracking-wide">
              {idNumber || "\u00a0"}
            </td>
          </tr>

          <tr>
            <td className="border border-stone-800 bg-stone-50 px-2 py-2 text-center font-semibold leading-snug">
              實扣
              <br />
              <span className="text-[11px] font-normal">二代健保（1.91%）</span>
            </td>
            <td className="border border-stone-800 px-2 py-2 text-center text-base font-semibold tabular-nums">
              {應扣繳 && 二代健保費 > 0 ? `-${二代健保費.toLocaleString("zh-TW")}` : "Ｘ"}
            </td>
            <td className="border border-stone-800 bg-stone-50 px-2 py-2 text-center font-semibold">
              聯絡電話
            </td>
            <td className="border border-stone-800 px-2 py-2 font-semibold">{phone || "\u00a0"}</td>
          </tr>

          <tr>
            <td className="border border-stone-800 bg-stone-50 px-2 py-2 text-center font-semibold">
              實領金額
            </td>
            <td className="border border-stone-800 px-2 py-2 text-right text-lg font-bold tabular-nums">
              {實領金額 > 0 ? 實領金額.toLocaleString("zh-TW") : ""}
            </td>
            <td className="border border-stone-800 bg-stone-50 px-2 py-2 text-center font-semibold">
              戶籍地址
            </td>
            <td className="border border-stone-800 px-2 py-2 text-[12px] leading-snug">{address || "\u00a0"}</td>
          </tr>

          <tr>
            <td className="border border-stone-800 bg-stone-50 px-2 py-2 text-center font-semibold leading-snug">
              備註
              <br />
              <span className="text-[11px] font-normal">（領款說明）</span>
            </td>
            <td colSpan={3} className="border border-stone-800 px-2 py-2 align-top">
              <p>
                <span>☑ 內容</span>
                <span className="ml-2">{laborContent || "________________________________"}</span>
              </p>
              {note?.trim() ? <p className="mt-1 text-[12px] text-stone-600">{note}</p> : null}
            </td>
          </tr>
        </tbody>
      </table>

      <p className="mt-3 text-[11px] leading-relaxed text-stone-600">*請附上身分證正反面影本於下方空白處</p>
      <p className="text-[11px] leading-relaxed text-stone-600">*{SDH_LABOR_RECEIPT_FOOTNOTE}</p>
      <div className="mt-4 grid min-h-[28mm] grid-cols-2 gap-3">
        <div className="flex flex-col items-center justify-center rounded border border-dashed border-stone-400 bg-stone-50/40 p-2">
          {String(idCardFrontUrl ?? "").trim() ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={String(idCardFrontUrl)}
              alt="身分證正面"
              className="max-h-[42mm] w-full object-contain"
            />
          ) : (
            <span className="text-[11px] text-stone-400">正面影本</span>
          )}
        </div>
        <div className="flex flex-col items-center justify-center rounded border border-dashed border-stone-400 bg-stone-50/40 p-2">
          {String(idCardBackUrl ?? "").trim() ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={String(idCardBackUrl)}
              alt="身分證反面"
              className="max-h-[42mm] w-full object-contain"
            />
          ) : (
            <span className="text-[11px] text-stone-400">反面影本</span>
          )}
        </div>
      </div>
    </div>
  );
}
