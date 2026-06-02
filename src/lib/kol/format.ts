export function parseKolAmount(v: string | null | undefined): number {
  if (v == null || String(v).trim() === "") return 0;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

export function formatKolAmountInt(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "—";
  return Math.round(n).toLocaleString("zh-TW");
}

export function sumKolInvoiceAmount含稅(
  invs: { 發票金額含稅?: string | null }[]
): string {
  let sum = 0;
  for (const inv of invs) {
    sum += parseKolAmount(inv.發票金額含稅);
  }
  return formatKolAmountInt(sum);
}
