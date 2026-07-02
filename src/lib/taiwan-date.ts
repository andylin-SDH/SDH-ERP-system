/** 台灣時區（Asia/Taipei）日期工具，供 cron／排程與畫面一致 */

export function getTaipeiDateString(date: Date = new Date()): string {
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

export function getTaipeiYmd(date: Date = new Date()): { year: number; month: number; day: number } {
  const s = getTaipeiDateString(date);
  const [year, month, day] = s.split("-").map((x) => Number(x));
  return { year, month, day };
}

export function daysInTaipeiMonth(year: number, month1to12: number): number {
  return new Date(year, month1to12, 0).getDate();
}

export function taipeiMonthKey(year: number, month1to12: number): string {
  return `${year}-${String(month1to12).padStart(2, "0")}`;
}

/** ISO / timestamptz → 台灣時間顯示（後端 UTC，畫面 Asia/Taipei） */
export function formatTaipeiDateTime(iso: string | null | undefined, withSeconds = false): string {
  if (iso == null || String(iso).trim() === "") return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" } : {}),
    hour12: false,
  });
}
