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
