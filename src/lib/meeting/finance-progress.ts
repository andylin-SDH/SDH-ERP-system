import type { FinanceRow } from "@/modules/finance/types";

export function financeProgressShortLabel(f: FinanceRow | undefined): string {
  if (!f) return "—";
  const v = String(f.廠商付款日期 ?? "").trim();
  const e = String(f.員工分潤日期 ?? "").trim();
  if (!v) return "待結帳";
  if (!e) return "待分潤";
  return "已分潤";
}
