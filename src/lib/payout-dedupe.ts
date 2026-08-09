/**
 * 分潤「同一人不重複計算」：與 sync / 讀取 API 共用，避免前後端字串不一致。
 */

import { parseAmount, parsePayoutRate } from "@/lib/payout-utils";
import type { PayoutDedupeRule } from "@/config/payout-dedupe-defaults";

/** 去除空白後比對用的鍵（中英混合：只壓縮空白，不改變大小寫以外的中文） */
function compactRoleKey(s: string): string {
  return String(s)
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, "");
}

/**
 * 每組第一個為 syncPayoutForProject 寫入 DB 的正式「分潤類型」，其餘為常見別名／舊資料寫法
 */
const PAYOUT_ROLE_SYNONYM_GROUPS: string[][] = [
  ["專案BDPM", "BDPM", "bdpm", "專案bdpm"],
  ["專案引薦人", "引薦人"],
  ["專案開發人", "開發人"],
  ["專案管理員", "管理員"],
  ["執行管理員"],
  ["經紀人"],
  ["主管"],
  ["KOL開發者", "KOL開發者", "kol開發者"],
];

const CANONICAL_BY_COMPACT = new Map<string, string>();
for (const group of PAYOUT_ROLE_SYNONYM_GROUPS) {
  const canonical = group[0];
  for (const syn of group) {
    CANONICAL_BY_COMPACT.set(compactRoleKey(syn), canonical);
  }
}

export function canonicalPayoutRoleKey(raw: string | null | undefined): string {
  const c = compactRoleKey(String(raw ?? ""));
  if (!c) return "";
  return CANONICAL_BY_COMPACT.get(c) ?? String(raw).normalize("NFKC").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
}

export function normalizeRecipientForDedupe(s: string | null | undefined): string {
  if (s == null) return "";
  return String(s)
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase()
    .trim();
}

/** 人工額外獎金：不進成數計算、重算時保留、同人去重時不與角色分潤合併 */
export const EXTRA_BONUS_PAYOUT_TYPE = "額外獎金";

export function isExtraBonusPayoutType(type: string | null | undefined): boolean {
  return String(type ?? "").trim() === EXTRA_BONUS_PAYOUT_TYPE;
}

/**
 * 同一專案內，同一領取人僅保留一列：取分潤成數最高者；成數相同則取分潤金額較大者。
 * 「額外獎金」列一律保留，不參與同人去重。
 */
export function applyHighestRatePerRecipient<
  T extends {
    分潤成數?: string | null;
    分潤金額?: string | null;
    領取人?: string | null;
    分潤類型?: string | null;
  },
>(rows: T[]): T[] {
  if (rows.length <= 1) return rows;

  const bonusIndices: number[] = [];
  const regularIndices: number[] = [];
  rows.forEach((row, i) => {
    if (isExtraBonusPayoutType(row.分潤類型)) bonusIndices.push(i);
    else regularIndices.push(i);
  });

  const byRecipient = new Map<string, number[]>();
  for (const i of regularIndices) {
    const key = normalizeRecipientForDedupe(rows[i].領取人) || "__empty__";
    if (!byRecipient.has(key)) byRecipient.set(key, []);
    byRecipient.get(key)!.push(i);
  }

  const keep = new Set<number>(bonusIndices);
  for (const indices of byRecipient.values()) {
    if (indices.length <= 1) {
      indices.forEach((idx) => keep.add(idx));
      continue;
    }
    let best = indices[0];
    let bestRate = parsePayoutRate(rows[best].分潤成數);
    let bestAmount = parseAmount(rows[best].分潤金額);
    for (let k = 1; k < indices.length; k++) {
      const idx = indices[k];
      const rate = parsePayoutRate(rows[idx].分潤成數);
      const amount = parseAmount(rows[idx].分潤金額);
      if (rate > bestRate || (rate === bestRate && amount > bestAmount)) {
        best = idx;
        bestRate = rate;
        bestAmount = amount;
      }
    }
    keep.add(best);
  }

  return rows.filter((_, i) => keep.has(i));
}

/** @deprecated 改為 applyHighestRatePerRecipient；保留供舊資料遷移參考 */
export function applyDedupeRules<T extends { 分潤類型?: string | null; 領取人?: string | null }>(
  rows: T[],
  rules: PayoutDedupeRule[]
): T[] {
  if (rules.length === 0) return rows;
  let result = [...rows];
  for (const rule of rules) {
    const roleSet = new Set((rule.roles ?? []).map((x) => canonicalPayoutRoleKey(x)).filter(Boolean));
    const keep = canonicalPayoutRoleKey(rule.keep);
    if (!keep || !roleSet.has(keep) || (rule.roles?.length ?? 0) < 2) continue;

    result = result.filter((row) => {
      const type = canonicalPayoutRoleKey(row.分潤類型);
      if (!roleSet.has(type)) return true;
      const recipient = normalizeRecipientForDedupe(row.領取人);

      const sameRecipient = result.filter(
        (r) =>
          roleSet.has(canonicalPayoutRoleKey(r.分潤類型)) && normalizeRecipientForDedupe(r.領取人) === recipient
      );
      if (sameRecipient.length < 2) return true;
      return canonicalPayoutRoleKey(row.分潤類型) === keep;
    });
  }
  return result;
}

/**
 * 同一專案內、同一領取人若有多列分潤，只保留一列：依 priority 中分潤類型的順序（越前面越優先）。
 * 未出現在 priority 的類型排在最後；同優先時保留在原始列中較早出現的那一列。
 */
export function applySameRecipientOneRow<T extends { 分潤類型?: string | null; 領取人?: string | null }>(
  rows: T[],
  enabled: boolean,
  priority: string[]
): T[] {
  if (!enabled || rows.length <= 1) return rows;
  const priorityIndex = new Map<string, number>();
  priority.forEach((p, i) => {
    const k = canonicalPayoutRoleKey(p);
    if (k) priorityIndex.set(k, i);
  });
  const defaultRank = 9999;
  const rank = (row: T) => priorityIndex.get(canonicalPayoutRoleKey(row.分潤類型)) ?? defaultRank;

  const byRecipient = new Map<string, number[]>();
  rows.forEach((row, i) => {
    const key = normalizeRecipientForDedupe(row.領取人) || "__empty__";
    if (!byRecipient.has(key)) byRecipient.set(key, []);
    byRecipient.get(key)!.push(i);
  });

  const keep = new Set<number>();
  for (const indices of byRecipient.values()) {
    if (indices.length <= 1) {
      indices.forEach((i) => keep.add(i));
      continue;
    }
    let best = indices[0];
    let bestR = rank(rows[best]);
    for (let k = 1; k < indices.length; k++) {
      const i = indices[k];
      const r = rank(rows[i]);
      if (r < bestR) {
        bestR = r;
        best = i;
      }
    }
    keep.add(best);
  }

  return rows.filter((_, i) => keep.has(i));
}
