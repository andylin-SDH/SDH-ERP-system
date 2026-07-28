export function financeProgressBadgeClass(short: string): string {
  if (short === "待結帳") return "bg-stone-200 text-stone-700";
  if (short === "待分潤") return "bg-amber-100 text-amber-900 ring-1 ring-amber-300/60";
  if (short === "已分潤") return "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300/50";
  return "bg-stone-100 text-stone-500";
}
