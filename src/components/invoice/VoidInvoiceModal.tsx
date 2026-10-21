"use client";

import { useState } from "react";

type VoidInvoiceTarget = {
  number: string;
  statusLabel: string;
  typeLabel: string;
};

/**
 * 獨立彈窗：作廢原因存在本地 state，打字不會重渲染整張發票清冊。
 */
export function VoidInvoiceModal({
  target,
  voiding,
  onCancel,
  onConfirm,
}: {
  target: VoidInvoiceTarget;
  voiding: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-stone-900/40 p-4">
      <div className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-5 shadow-2xl">
        <h2 className="text-lg font-bold text-stone-900">作廢發票</h2>
        <p className="mt-1 text-sm text-stone-600">
          將作廢 <span className="font-semibold text-stone-900">{target.number}</span>。清冊保留這筆，金額與付款日不變。
        </p>
        <p className="mt-2 text-xs text-stone-500">
          光貿狀態：{target.typeLabel}／{target.statusLabel}（剛查過，可作廢）
        </p>
        <label className="mt-4 block text-xs font-semibold text-stone-500">
          作廢原因（最多 20 字）
          <input
            value={reason}
            maxLength={20}
            autoFocus
            onChange={(e) => setReason(e.target.value)}
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900"
            placeholder="例如：金額開錯"
          />
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            disabled={voiding}
            onClick={onCancel}
            className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-semibold text-stone-600"
          >
            取消
          </button>
          <button
            type="button"
            disabled={voiding || !reason.trim()}
            onClick={() => onConfirm(reason.trim())}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50"
          >
            {voiding ? "作廢中…" : "確認作廢"}
          </button>
        </div>
      </div>
    </div>
  );
}
