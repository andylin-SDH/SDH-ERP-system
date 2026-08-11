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
  grossAmount: string;
  idNumber: string;
  phone: string;
  address: string;
  laborContent: string;
  note?: string;
};

export function KolLaborReceiptPreview({
  recipientName,
  receiptDate,
  paymentMethod,
  grossAmount,
  idNumber,
  phone,
  address,
  laborContent,
  note,
}: KolLaborReceiptPreviewProps) {
  const roc = formatRocDate(receiptDate);
  const w = calcLaborWithholding(grossAmount);
  const upper = formatTwdChineseUpper(grossAmount);

  return (
    <div className="rounded-lg border-2 border-stone-800 bg-white p-4 text-sm text-stone-900 shadow-inner">
      <p className="text-center text-base font-bold tracking-wide">{SDH_LABOR_RECEIPT_COMPANY}</p>
      <p className="mt-1 text-center text-lg font-bold tracking-[0.2em]">勞務報酬收據</p>
      <p className="mt-3 text-right tabular-nums">
        {roc.year} 年 {roc.month} 月 {roc.day} 日
      </p>

      <div className="mt-4 space-y-3 border-t border-stone-300 pt-3 text-[13px] leading-relaxed">
        <p>
          茲收到
          <span className="mx-2 inline-flex gap-3">
            <span>{paymentMethod === "現金" ? "☑" : "□"} 現金</span>
            <span>{paymentMethod === "匯款" ? "☑" : "□"} 匯款</span>
          </span>
          新台幣（大寫）：
          <span className="mx-1 font-semibold underline decoration-stone-400 underline-offset-2">
            {upper || "　　　　　"}
          </span>
          元　（NT$）
          <span className="ml-1 font-semibold tabular-nums">{w.應領金額 > 0 ? w.應領金額.toLocaleString("zh-TW") : "______________"}</span>
        </p>

        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded border border-stone-300 p-2">
            <p className="text-xs text-stone-500">應領金額</p>
            <p className="text-right text-base font-bold tabular-nums">{w.應領金額.toLocaleString("zh-TW")}</p>
          </div>
          <div className="rounded border border-stone-300 p-2">
            <p className="text-xs text-stone-500">領款人（簽章）</p>
            <p className="mt-1 min-h-[1.5rem] font-semibold">{recipientName || "　　　　　"}</p>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded border border-stone-300 p-2">
            <p className="text-xs text-stone-500">實扣稅款－各類所得（10%）</p>
            <p className="text-right font-semibold tabular-nums">
              {w.應扣繳 ? `-${w.扣繳稅額.toLocaleString("zh-TW")}` : "Ｘ"}
            </p>
          </div>
          <div className="rounded border border-stone-300 p-2">
            <p className="text-xs text-stone-500">身分證字號</p>
            <p className="font-mono font-semibold">{idNumber || "　　　　　"}</p>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded border border-stone-300 p-2">
            <p className="text-xs text-stone-500">實扣－二代健保（1.91%）</p>
            <p className="text-right font-semibold tabular-nums">
              {w.應扣繳 ? `-${w.二代健保費.toLocaleString("zh-TW")}` : "Ｘ"}
            </p>
          </div>
          <div className="rounded border border-stone-300 p-2">
            <p className="text-xs text-stone-500">聯絡電話</p>
            <p className="font-semibold">{phone || "　　　　　"}</p>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded border border-stone-300 p-2">
            <p className="text-xs text-stone-500">實領金額</p>
            <p className="text-right text-lg font-bold tabular-nums text-emerald-900">
              {w.實領金額.toLocaleString("zh-TW")}
            </p>
          </div>
          <div className="rounded border border-stone-300 p-2">
            <p className="text-xs text-stone-500">戶籍地址</p>
            <p className="text-sm leading-snug">{address || "　　　　　"}</p>
          </div>
        </div>

        <div className="rounded border border-stone-300 p-2">
          <p className="text-xs text-stone-500">備註（領款說明）</p>
          <p className="mt-1">
            <span>☑ 內容</span>
            <span className="ml-2">{laborContent || "______________________________________"}</span>
          </p>
          {note?.trim() ? <p className="mt-1 text-xs text-stone-600">{note}</p> : null}
        </div>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-stone-500">* 請附上身分證正反面影本於下方空白處</p>
      <p className="text-[11px] leading-relaxed text-amber-800">* {SDH_LABOR_RECEIPT_FOOTNOTE}</p>
      <div className="mt-6 min-h-[4rem] border border-dashed border-stone-300 bg-stone-50/50" title="身分證影本黏貼區" />
    </div>
  );
}
