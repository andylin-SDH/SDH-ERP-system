/** B2B 發票金額。光貿 DetailVat：0 未稅、1 含稅。金額四捨五入至整數元。 */

export type B2bTaxKind = "taxable" | "zero" | "exempt";
export type B2bPriceMode = "untaxed" | "taxed";

export type B2bLineInput = {
  description: string;
  quantity: number;
  unitPrice: number;
};

export type B2bLine = {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  taxType: 1 | 2 | 3;
};

export type B2bTotals = {
  lines: B2bLine[];
  salesAmount: number;
  freeTaxSalesAmount: number;
  zeroTaxSalesAmount: number;
  taxAmount: number;
  totalAmount: number;
  taxType: 1 | 2 | 3;
  taxRate: string;
  detailVat: 0 | 1;
};

function roundMoney(n: number): number {
  return Math.round(n);
}

function taxTypeFor(kind: B2bTaxKind): 1 | 2 | 3 {
  if (kind === "zero") return 2;
  if (kind === "exempt") return 3;
  return 1;
}

export function calcB2bTotals(
  items: B2bLineInput[],
  kind: B2bTaxKind,
  priceMode: B2bPriceMode,
  options?: { requireDescription?: boolean }
): B2bTotals {
  const taxType = taxTypeFor(kind);
  const requireDescription = options?.requireDescription !== false;
  const lines: B2bLine[] = items
    .map((item) => {
      const description = item.description.trim();
      const quantity = item.quantity;
      const unitPrice = item.unitPrice;
      const amount = roundMoney(quantity * unitPrice);
      return { description, quantity, unitPrice, amount, taxType };
    })
    .filter(
      (line) =>
        Number.isFinite(line.quantity) &&
        line.quantity > 0 &&
        Number.isFinite(line.amount) &&
        line.amount !== 0 &&
        (!requireDescription || line.description !== "")
    );

  const sum = lines.reduce((acc, line) => acc + line.amount, 0);
  const detailVat: 0 | 1 = priceMode === "taxed" ? 1 : 0;

  if (kind === "exempt") {
    return {
      lines,
      salesAmount: 0,
      freeTaxSalesAmount: sum,
      zeroTaxSalesAmount: 0,
      taxAmount: 0,
      totalAmount: sum,
      taxType,
      taxRate: "0",
      detailVat,
    };
  }

  if (kind === "zero") {
    return {
      lines,
      salesAmount: 0,
      freeTaxSalesAmount: 0,
      zeroTaxSalesAmount: sum,
      taxAmount: 0,
      totalAmount: sum,
      taxType,
      taxRate: "0",
      detailVat,
    };
  }

  if (priceMode === "taxed") {
    const taxAmount = sum - roundMoney(sum / 1.05);
    const salesAmount = sum - taxAmount;
    return {
      lines,
      salesAmount,
      freeTaxSalesAmount: 0,
      zeroTaxSalesAmount: 0,
      taxAmount,
      totalAmount: salesAmount + taxAmount,
      taxType,
      taxRate: "0.05",
      detailVat,
    };
  }

  const salesAmount = sum;
  const taxAmount = roundMoney(salesAmount * 0.05);
  return {
    lines,
    salesAmount,
    freeTaxSalesAmount: 0,
    zeroTaxSalesAmount: 0,
    taxAmount,
    totalAmount: salesAmount + taxAmount,
    taxType,
    taxRate: "0.05",
    detailVat,
  };
}
