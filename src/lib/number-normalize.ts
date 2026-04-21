/**
 * 數字字串正規化：
 * - 移除千分位逗號
 * - 避免 JS 浮點尾差（例如 5400.059999999）
 * - 以固定小數位四捨五入，再轉回最短可讀字串
 */
export function normalizeDecimalString(
  raw: unknown,
  fractionDigits = 2
): string | undefined {
  if (raw == null) return undefined;
  const s = String(raw).trim();
  if (!s) return "";
  const n = Number(s.replace(/,/g, ""));
  if (!Number.isFinite(n)) return s;
  const safeDigits = Math.max(0, Math.min(8, Math.floor(fractionDigits)));
  const rounded = Number(n.toFixed(safeDigits));
  return String(rounded);
}

