/** 與員工端大總表相同：空狀態視為進行中 */
export function isKolProjectInProgress(專案狀態: string | null | undefined): boolean {
  const s = String(專案狀態 ?? "").trim();
  if (!s) return true;
  const lower = s.toLowerCase();
  if (lower.includes("結案") || lower.includes("完結") || lower === "完成" || lower.includes("已結束")) {
    return false;
  }
  return true;
}
