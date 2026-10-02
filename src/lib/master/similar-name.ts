/**
 * 開案／改名時比對既有專案名稱。
 * 同一位老師（KOL名稱）只應對一筆請款；名稱太接近會多一筆待請款，而且對不上那一張發票。
 * 只讀既有列，不改資料。
 */

export type SimilarProjectMatch = {
  專案ID: string;
  專案名稱: string;
  KOL名稱: string;
  專案狀態: string;
  /** same：正規化後完全相同；similar：名稱很接近 */
  level: "same" | "similar";
};

type NameRow = {
  專案ID?: string | null;
  專案名稱?: string | null;
  KOL名稱?: string | null;
  專案狀態?: string | null;
};

/** 比對用：去空白、符號，不分大小寫 */
export function normalizeProjectNameKey(name: string): string {
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[|｜·・,，.。、/／\\()（）[\]【】「」"'“”\-—_]/g, "");
}

function bigramDice(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const counts = new Map<string, number>();
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.slice(i, i + 2);
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  let hit = 0;
  for (let i = 0; i < a.length - 1; i++) {
    const g = a.slice(i, i + 2);
    const n = counts.get(g) ?? 0;
    if (n > 0) {
      hit += 1;
      counts.set(g, n - 1);
    }
  }
  return (2 * hit) / (a.length - 1 + (b.length - 1));
}

function nameScore(a: string, b: string): { score: number; level: "same" | "similar" } | null {
  if (!a || !b || a.length < 4 || b.length < 4) return null;
  if (a === b) return { score: 1, level: "same" };
  let score = bigramDice(a, b);
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length >= 6 && longer.includes(shorter) && shorter.length / longer.length >= 0.55) {
    score = Math.max(score, 0.9);
  }
  if (score >= 0.82) return { score, level: "similar" };
  return null;
}

export function findSimilarProjectNames(
  rows: NameRow[],
  input: { 專案名稱?: string | null; KOL名稱?: string | null; excludeId?: string | null }
): SimilarProjectMatch[] {
  const nameKey = normalizeProjectNameKey(String(input.專案名稱 ?? ""));
  if (nameKey.length < 4) return [];
  const kol = String(input.KOL名稱 ?? "").trim();
  // 表單先填專案名稱、後選老師。老師還沒選時無法分辨是不是同一人，先不提醒。
  if (!kol) return [];
  const exclude = String(input.excludeId ?? "").trim();
  const hits: Array<SimilarProjectMatch & { score: number }> = [];

  for (const row of rows) {
    const id = String(row.專案ID ?? "").trim();
    if (!id || (exclude && id === exclude)) continue;
    const rowKol = String(row.KOL名稱 ?? "").trim();
    if (rowKol !== kol) continue;
    const rowKey = normalizeProjectNameKey(String(row.專案名稱 ?? ""));
    const judged = nameScore(nameKey, rowKey);
    if (!judged) continue;
    hits.push({
      專案ID: id,
      專案名稱: String(row.專案名稱 ?? "").trim() || id,
      KOL名稱: rowKol,
      專案狀態: String(row.專案狀態 ?? "").trim(),
      level: judged.level,
      score: judged.score,
    });
  }

  hits.sort((a, b) => b.score - a.score || a.專案名稱.localeCompare(b.專案名稱, "zh-Hant"));
  return hits.slice(0, 5).map(({ score: _score, ...rest }) => rest);
}
