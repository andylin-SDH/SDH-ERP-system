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
  /** 是否顯示身分證影本區（批次兩份一頁時通常只放上半張） */
  showIdCards?: boolean;
  /** 半張 A4 濃縮版（預設 true） */
  compact?: boolean;
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
  showIdCards = true,
  compact = true,
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
  const cell = compact ? "border border-stone-800 px-1.5 py-1" : "border border-stone-800 px-2 py-2";
  const label = `${cell} bg-stone-50 text-center font-semibold`;
  const textSize = compact ? "text-[11px]" : "text-[13px]";

  return (
    <div
      className={`labor-receipt-sheet bg-white text-stone-900 ${className}`}
      style={{
        width: "210mm",
        maxWidth: "100%",
        height: compact ? "148.5mm" : undefined,
        minHeight: compact ? undefined : "140mm",
        padding: compact ? "5mm 8mm 4mm" : "12mm 14mm",
        boxSizing: "border-box",
        overflow: "hidden",
        fontFamily: '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif',
      }}
    >
      <div className="flex items-end justify-between gap-2">
        <div>
          <p className={`font-bold tracking-wide ${compact ? "text-[13px]" : "text-[18px]"}`}>
            {SDH_LABOR_RECEIPT_COMPANY}
          </p>
          <p className={`font-bold tracking-[0.28em] ${compact ? "text-[15px] leading-tight" : "mt-1 text-[20px]"}`}>
            勞務報酬收據
          </p>
        </div>
        <p className={`shrink-0 tabular-nums ${compact ? "text-[11px]" : "text-[13px]"}`}>
          {roc.year}年　{roc.month}　月　{roc.day}　日
        </p>
      </div>

      <table
        className={`mt-1.5 w-full border-collapse border border-stone-800 ${textSize}`}
        style={{ tableLayout: "fixed" }}
      >
        <tbody>
          <tr>
            <td colSpan={4} className={`${cell} align-middle`}>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="shrink-0 font-semibold">茲收到</span>
                <span className="inline-flex gap-2">
                  <span>{paymentMethod === "現金" ? "☑" : "□"} 現金</span>
                  <span>{paymentMethod === "匯款" ? "☑" : "□"} 匯款</span>
                </span>
                <span className="shrink-0">新台幣(大寫)：</span>
                <span className="min-w-[8rem] flex-1 border-b border-stone-500 font-semibold">
                  {upper || "\u00a0"}
                </span>
                <span className="shrink-0">元</span>
                <span className="shrink-0">（NT$）：</span>
                <span className="min-w-[4rem] border-b border-stone-500 font-semibold tabular-nums">
                  {應領金額 > 0 ? 應領金額.toLocaleString("zh-TW") : "\u00a0"}
                </span>
              </div>
            </td>
          </tr>

          <tr>
            <td className={`w-[16%] ${label}`}>應領金額</td>
            <td className={`w-[34%] ${cell} text-right font-bold tabular-nums ${compact ? "text-[13px]" : "text-base"}`}>
              {應領金額 > 0 ? 應領金額.toLocaleString("zh-TW") : ""}
            </td>
            <td className={`w-[16%] ${label}`}>領款人</td>
            <td className={`w-[34%] ${cell} align-top`}>
              <div className={`flex items-end justify-between gap-1 ${compact ? "min-h-[1.75rem]" : "min-h-[3.5rem]"}`}>
                <div className="min-w-0">
                  <p className={`font-semibold leading-tight ${compact ? "text-[11px]" : ""}`}>
                    {recipientName || "\u00a0"}
                  </p>
                  {sig.startsWith("data:image") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={sig}
                      alt="簽名"
                      className={`mt-0.5 object-contain ${compact ? "h-6 max-w-[7rem]" : "h-10 max-w-[9rem]"}`}
                    />
                  ) : null}
                </div>
                <span className="shrink-0 text-[10px] text-stone-500">（簽章）</span>
              </div>
            </td>
          </tr>

          <tr>
            <td className={`${label} leading-snug`}>
              實扣稅款
              <br />
              <span className="text-[9px] font-normal">各類所得（10%）</span>
            </td>
            <td className={`${cell} text-center font-semibold tabular-nums`}>
              {應扣繳 && 扣繳稅額 > 0 ? `-${扣繳稅額.toLocaleString("zh-TW")}` : "Ｘ"}
            </td>
            <td className={label}>身分證字號</td>
            <td className={`${cell} font-mono font-semibold tracking-wide`}>{idNumber || "\u00a0"}</td>
          </tr>

          <tr>
            <td className={`${label} leading-snug`}>
              實扣
              <br />
              <span className="text-[9px] font-normal">二代健保（1.91%）</span>
            </td>
            <td className={`${cell} text-center font-semibold tabular-nums`}>
              {應扣繳 && 二代健保費 > 0 ? `-${二代健保費.toLocaleString("zh-TW")}` : "Ｘ"}
            </td>
            <td className={label}>聯絡電話</td>
            <td className={`${cell} font-semibold`}>{phone || "\u00a0"}</td>
          </tr>

          <tr>
            <td className={label}>實領金額</td>
            <td className={`${cell} text-right font-bold tabular-nums ${compact ? "text-[13px]" : "text-lg"}`}>
              {實領金額 > 0 ? 實領金額.toLocaleString("zh-TW") : ""}
            </td>
            <td className={label}>戶籍地址</td>
            <td className={`${cell} leading-snug ${compact ? "text-[10px]" : "text-[12px]"}`}>
              {address || "\u00a0"}
            </td>
          </tr>

          <tr>
            <td className={`${label} leading-snug`}>
              備註
              <br />
              <span className="text-[9px] font-normal">（領款說明）</span>
            </td>
            <td colSpan={3} className={`${cell} align-top`}>
              <p className="leading-snug">
                <span>☑ 內容</span>
                <span className="ml-1.5">{laborContent || "________________________________"}</span>
              </p>
              {note?.trim() ? (
                <p className={`mt-0.5 text-stone-600 ${compact ? "text-[10px] leading-snug" : "text-[12px]"}`}>
                  {note}
                </p>
              ) : null}
            </td>
          </tr>
        </tbody>
      </table>

      <p className={`mt-1 text-stone-600 ${compact ? "text-[9px] leading-snug" : "mt-3 text-[11px] leading-relaxed"}`}>
        *請附上身分證正反面影本於下方空白處　*{SDH_LABOR_RECEIPT_FOOTNOTE}
      </p>

      {showIdCards ? (
        <div className={`grid grid-cols-2 gap-2 ${compact ? "mt-1.5 h-[28mm]" : "mt-4 min-h-[28mm]"}`}>
          <div className="flex h-full flex-col items-center justify-center overflow-hidden rounded border border-dashed border-stone-400 bg-stone-50/40 p-1">
            {String(idCardFrontUrl ?? "").trim() ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={String(idCardFrontUrl)}
                alt="身分證正面"
                className={`w-full object-contain ${compact ? "max-h-[26mm]" : "max-h-[42mm]"}`}
              />
            ) : (
              <span className="text-[10px] text-stone-400">正面影本</span>
            )}
          </div>
          <div className="flex h-full flex-col items-center justify-center overflow-hidden rounded border border-dashed border-stone-400 bg-stone-50/40 p-1">
            {String(idCardBackUrl ?? "").trim() ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={String(idCardBackUrl)}
                alt="身分證反面"
                className={`w-full object-contain ${compact ? "max-h-[26mm]" : "max-h-[42mm]"}`}
              />
            ) : (
              <span className="text-[10px] text-stone-400">反面影本</span>
            )}
          </div>
        </div>
      ) : (
        <p className="mt-1 text-[9px] text-stone-400">（身分證影本見本頁上半張）</p>
      )}
    </div>
  );
}
