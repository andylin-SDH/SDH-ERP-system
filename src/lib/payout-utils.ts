export function parsePayoutRate(input: string | null | undefined): number {
  if (!input) return 0;
  const raw = String(input).trim();
  if (!raw) return 0;

  const withoutPercent = raw.endsWith("%") ? raw.slice(0, -1).trim() : raw;
  const value = Number(withoutPercent.replace(/,/g, ""));
  if (!Number.isFinite(value) || Number.isNaN(value)) return 0;

  return value / 100;
}

/** 解析金額字串為數字（用於分潤金額計算） */
export function parseAmount(input: string | null | undefined): number {
  if (input == null || input === "") return 0;
  const raw = String(input).trim().replace(/,/g, "");
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

