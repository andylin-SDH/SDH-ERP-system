"use client";

import type { SimilarProjectMatch } from "@/lib/master/similar-name";

export function SimilarProjectNotice({
  id,
  matches,
  acknowledged,
  onAcknowledge,
}: {
  id?: string;
  matches: SimilarProjectMatch[];
  acknowledged: boolean;
  onAcknowledge: (on: boolean) => void;
}) {
  if (matches.length === 0) return null;
  const hasSame = matches.some((m) => m.level === "same");
  return (
    <div id={id} className="col-span-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-950">
      <p className="font-semibold">
        {hasSame ? "這位老師已有相同名稱的專案。" : "這位老師已有名稱很接近的專案。"}
        一位老師對一筆請款、一張發票。再開一筆，老師端會多一筆待請款，而且對不上發票。
      </p>
      <ul className="mt-2 space-y-1">
        {matches.map((m) => (
          <li key={m.專案ID} className="text-xs text-amber-950/90">
            <span className="font-semibold">{m.專案名稱}</span>
            <span className="text-amber-900/70">
              {" "}
              · {m.專案ID}
              {m.KOL名稱 ? ` · ${m.KOL名稱}` : ""}
              {m.專案狀態 ? ` · ${m.專案狀態}` : ""}
              {m.level === "same" ? " · 名稱相同" : " · 名稱接近"}
            </span>
          </li>
        ))}
      </ul>
      <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs font-semibold text-stone-800">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => onAcknowledge(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-stone-300 text-amber-500 focus:ring-amber-400"
        />
        我確認這是不同專案，仍要儲存
      </label>
    </div>
  );
}
