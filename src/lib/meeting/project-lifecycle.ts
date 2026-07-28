/** 進行中：排除明顯已結案／完成狀態（空狀態視為進行中） */
export function isProjectInProgress(專案狀態: string | null | undefined): boolean {
  const s = String(專案狀態 ?? "").trim();
  if (!s) return true;
  const lower = s.toLowerCase();
  if (lower.includes("結案") || lower.includes("完結") || lower === "完成" || lower.includes("已結束")) {
    return false;
  }
  return true;
}

export function normalizeDateYmd(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const t = Date.parse(s);
  if (!Number.isNaN(t)) {
    const d = new Date(t);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  return "";
}

export function isDateBeforeToday(ymd: string): boolean {
  if (!ymd) return false;
  const today = new Date();
  const t = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return ymd < t;
}
