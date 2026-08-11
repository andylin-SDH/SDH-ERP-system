/**
 * KOL 勞報批次拆單：合計重新打包成每張 < 20,000（預設塊 18,000）
 * 例：120000 → 18000×6 + 12000
 */

export const KOL_LABOR_SLIP_MAX = 19999;
export const KOL_LABOR_SLIP_PREFERRED = 18000;

export type ClaimProjectAmount = {
  專案ID: string;
  金額: number;
  專案名稱?: string;
};

export type LaborSlipChunk = {
  序號: number;
  給付總額: number;
};

export type LaborSlipAllocation = {
  序號: number;
  專案ID: string;
  分配金額: number;
};

export type ClaimSplitResult = {
  total: number;
  slips: LaborSlipChunk[];
  allocations: LaborSlipAllocation[];
};

function toPositiveInt(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n);
}

/** 將合計切成 preferred 塊，最後一筆放餘額（皆必須 < max） */
export function splitTotalIntoSlips(
  totalRaw: number,
  preferred = KOL_LABOR_SLIP_PREFERRED,
  max = KOL_LABOR_SLIP_MAX
): LaborSlipChunk[] {
  const total = toPositiveInt(totalRaw);
  if (total <= 0) return [];
  if (preferred <= 0 || preferred >= max) {
    throw new Error(`preferred 必須介於 1～${max - 1}`);
  }

  const slips: LaborSlipChunk[] = [];
  let remaining = total;
  while (remaining > preferred) {
    slips.push({ 序號: slips.length + 1, 給付總額: preferred });
    remaining -= preferred;
  }
  if (remaining > 0) {
    if (remaining >= max) {
      throw new Error(`無法拆單：餘額 ${remaining} 仍 ≥ ${max}`);
    }
    slips.push({ 序號: slips.length + 1, 給付總額: remaining });
  }

  for (const s of slips) {
    if (s.給付總額 <= 0 || s.給付總額 >= max) {
      throw new Error(`單據金額不合法：${s.給付總額}`);
    }
  }
  return slips;
}

/** FIFO：把各專案餘額填進各張單據（可跨單據切開） */
export function allocateProjectsToSlips(
  projects: ClaimProjectAmount[],
  slips: LaborSlipChunk[]
): LaborSlipAllocation[] {
  const remaining = new Map<string, number>();
  const order: string[] = [];
  for (const p of projects) {
    const pid = String(p.專案ID ?? "").trim();
    const amt = toPositiveInt(p.金額);
    if (!pid || amt <= 0) continue;
    remaining.set(pid, (remaining.get(pid) ?? 0) + amt);
    if (!order.includes(pid)) order.push(pid);
  }

  const projectTotal = [...remaining.values()].reduce((a, b) => a + b, 0);
  const slipTotal = slips.reduce((a, s) => a + s.給付總額, 0);
  if (projectTotal !== slipTotal) {
    throw new Error(`拆單合計不一致：專案 ${projectTotal} ≠ 單據 ${slipTotal}`);
  }

  const allocations: LaborSlipAllocation[] = [];
  let pi = 0;
  for (const slip of slips) {
    let need = slip.給付總額;
    while (need > 0 && pi < order.length) {
      const pid = order[pi]!;
      const left = remaining.get(pid) ?? 0;
      if (left <= 0) {
        pi += 1;
        continue;
      }
      const take = Math.min(left, need);
      allocations.push({ 序號: slip.序號, 專案ID: pid, 分配金額: take });
      remaining.set(pid, left - take);
      need -= take;
      if ((remaining.get(pid) ?? 0) <= 0) pi += 1;
    }
    if (need > 0) {
      throw new Error(`單據 #${slip.序號} 無法填滿（缺 ${need}）`);
    }
  }

  for (const [pid, left] of remaining) {
    if (left > 0) throw new Error(`專案 ${pid} 尚有未分配 ${left}`);
  }

  return allocations;
}

export function buildLaborClaimSplit(
  projects: ClaimProjectAmount[],
  preferred = KOL_LABOR_SLIP_PREFERRED,
  max = KOL_LABOR_SLIP_MAX
): ClaimSplitResult {
  const cleaned = projects
    .map((p) => ({
      專案ID: String(p.專案ID ?? "").trim(),
      金額: toPositiveInt(p.金額),
      專案名稱: p.專案名稱,
    }))
    .filter((p) => p.專案ID && p.金額 > 0);

  const total = cleaned.reduce((a, p) => a + p.金額, 0);
  if (total <= 0) {
    return { total: 0, slips: [], allocations: [] };
  }

  const slips = splitTotalIntoSlips(total, preferred, max);
  const allocations = allocateProjectsToSlips(cleaned, slips);
  return { total, slips, allocations };
}
