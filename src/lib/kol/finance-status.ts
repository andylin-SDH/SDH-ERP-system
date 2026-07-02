/**
 * KOL 入口用：以 KOL 視角顯示款項進度（與內部「待結帳／待分潤」語意對應，用語不同）
 */
export function kolFinanceProgressShort(廠商付款日期?: string | null, 員工分潤日期?: string | null): string {
  const v = String(廠商付款日期 ?? "").trim();
  const e = String(員工分潤日期 ?? "").trim();
  if (!v) return "未入帳";
  if (!e) return "可提領";
  return "已分潤";
}
