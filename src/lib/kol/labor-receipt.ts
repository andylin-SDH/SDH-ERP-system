/**
 * 勞務報酬收據：扣繳試算與金額格式（對齊 SDH 範本）
 * 單次 ≥ 20,000：扣繳 10% 各類所得 + 1.91% 二代健保
 */

const CN_DIGITS = ["零", "壹", "貳", "參", "肆", "伍", "陸", "柒", "捌", "玖"] as const;
const CN_UNITS = ["", "拾", "佰", "仟", "萬", "拾", "佰", "仟", "億"] as const;

export type LaborPaymentMethod = "現金" | "匯款";

export type LaborWithholdingResult = {
  應領金額: number;
  扣繳稅額: number;
  二代健保費: number;
  實領金額: number;
  應扣繳: boolean;
};

export function parseLaborGrossAmount(raw: string | number | null | undefined): number {
  const n = typeof raw === "number" ? raw : parseFloat(String(raw ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/** 單次支付達 20,000 元預扣 10% + 1.91% */
export function calcLaborWithholding(grossRaw: string | number | null | undefined): LaborWithholdingResult {
  const 應領金額 = parseLaborGrossAmount(grossRaw);
  if (應領金額 < 20000) {
    return { 應領金額, 扣繳稅額: 0, 二代健保費: 0, 實領金額: 應領金額, 應扣繳: false };
  }
  const 扣繳稅額 = Math.round(應領金額 * 0.1);
  const 二代健保費 = Math.round(應領金額 * 0.0191);
  const 實領金額 = 應領金額 - 扣繳稅額 - 二代健保費;
  return { 應領金額, 扣繳稅額, 二代健保費, 實領金額, 應扣繳: true };
}

function section4(n: number): string {
  const s = String(Math.max(0, Math.floor(n)));
  const padded = s.padStart(4, "0").slice(-4);
  let out = "";
  for (let i = 0; i < 4; i++) {
    const d = Number(padded[i]);
    const unit = CN_UNITS[3 - i];
    if (d === 0) {
      if (out && !out.endsWith("零") && i < 3) out += "零";
      continue;
    }
    out += `${CN_DIGITS[d]}${unit}`;
  }
  return out.replace(/零+$/g, "").replace(/零+/g, "零") || "零";
}

/** 新台幣大寫（整數元，勞報收據用） */
export function formatTwdChineseUpper(amountRaw: string | number | null | undefined): string {
  const n = parseLaborGrossAmount(amountRaw);
  if (n <= 0) return "";
  if (n >= 100000000) return String(n);
  const wan = Math.floor(n / 10000);
  const rest = n % 10000;
  if (wan > 0 && rest > 0) return `${section4(wan)}萬${section4(rest)}`;
  if (wan > 0) return `${section4(wan)}萬`;
  return section4(rest);
}

export function formatRocDate(isoDate?: string | null): { year: string; month: string; day: string } {
  const d = String(isoDate ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const now = new Date();
    return {
      year: String(now.getFullYear() - 1911),
      month: String(now.getMonth() + 1),
      day: String(now.getDate()),
    };
  }
  const [y, m, day] = d.split("-");
  return { year: String(Number(y) - 1911), month: String(Number(m)), day: String(Number(day)) };
}

export const SDH_LABOR_RECEIPT_COMPANY = "盛德好股份有限公司";

export const SDH_LABOR_RECEIPT_FOOTNOTE =
  "單次支付金額達 20,000 元需預先代所得人扣繳 10% 各類所得及 1.91% 二代健保費用";
