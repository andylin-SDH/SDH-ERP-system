"use client";

import type { PaidDuplicateAlertLine } from "@/lib/master/similar-name";

/** 只顯示警示，沒有按鈕、不會改資料。 */
export function PaidDuplicateAlert({ lines }: { lines: PaidDuplicateAlertLine[] }) {
  if (lines.length === 0) return null;
  return (
    <div role="status" className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-950">
      <p className="font-semibold">匯出前先看：同一位老師有名稱相近的專案。</p>
      <ul className="mt-2 space-y-1">
        {lines.map((line) => (
          <li key={line.key} className="text-xs text-amber-950/90">
            {line.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
