/**
 * KOL 入口用：與員工端相同的款項進度語意（僅顯示，不依賴 dashboard）
 */
export function kolFinanceProgressShort(廠商付款日期?: string | null, 員工分潤日期?: string | null): string {
  const v = String(廠商付款日期 ?? "").trim();
  const e = String(員工分潤日期 ?? "").trim();
  if (!v) return "待結帳";
  if (!e) return "待分潤";
  return "已分潤";
}
