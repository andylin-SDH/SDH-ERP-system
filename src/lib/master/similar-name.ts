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

export type PaidDuplicatePeer = {
  專案ID: string;
  專案名稱: string;
  KOL名稱: string;
  專案狀態: string;
  /** 在匯出清單：KOL 待匯款／已匯款，或員工分潤待付／已付 */
  paid: boolean;
  level: "same" | "similar";
};

type WatchRow = NameRow & {
  母專案ID?: string | null;
  paid?: boolean;
};

/**
 * 公司要匯出去（或已經匯出）的專案，固定跟同一位老師的其他專案比名稱。
 * 至少一筆在匯出清單才成組。直接母子專案不算重複。只讀，不改資料。
 * 回傳：專案ID → 對方專案（最多 5 筆）。
 */
export function buildPaidDuplicatePeers(rows: WatchRow[]): Map<string, PaidDuplicatePeer[]> {
  const byId = new Map<string, WatchRow>();
  const byKol = new Map<string, WatchRow[]>();
  for (const row of rows) {
    const id = String(row.專案ID ?? "").trim();
    const kol = String(row.KOL名稱 ?? "").trim();
    if (!id || !kol) continue;
    byId.set(id, row);
    const list = byKol.get(kol) ?? [];
    list.push(row);
    byKol.set(kol, list);
  }

  const adj = new Map<string, Map<string, "same" | "similar">>();
  const link = (a: string, b: string, level: "same" | "similar") => {
    let peers = adj.get(a);
    if (!peers) {
      peers = new Map();
      adj.set(a, peers);
    }
    const cur = peers.get(b);
    if (!cur || level === "same") peers.set(b, level);
  };

  for (const group of byKol.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        const aId = String(a.專案ID ?? "").trim();
        const bId = String(b.專案ID ?? "").trim();
        const aParent = String(a.母專案ID ?? "").trim();
        const bParent = String(b.母專案ID ?? "").trim();
        if ((aParent && aParent === bId) || (bParent && bParent === aId)) continue;
        if (!a.paid && !b.paid) continue;
        const judged = nameScore(
          normalizeProjectNameKey(String(a.專案名稱 ?? "")),
          normalizeProjectNameKey(String(b.專案名稱 ?? ""))
        );
        if (!judged) continue;
        link(aId, bId, judged.level);
        link(bId, aId, judged.level);
      }
    }
  }

  const result = new Map<string, PaidDuplicatePeer[]>();
  for (const [id, peers] of adj) {
    const list: PaidDuplicatePeer[] = [];
    for (const [peerId, level] of peers) {
      const row = byId.get(peerId);
      if (!row) continue;
      list.push({
        專案ID: peerId,
        專案名稱: String(row.專案名稱 ?? "").trim() || peerId,
        KOL名稱: String(row.KOL名稱 ?? "").trim(),
        專案狀態: String(row.專案狀態 ?? "").trim(),
        paid: Boolean(row.paid),
        level,
      });
    }
    list.sort(
      (a, b) => Number(b.paid) - Number(a.paid) || a.專案名稱.localeCompare(b.專案名稱, "zh-Hant")
    );
    if (list.length > 0) result.set(id, list.slice(0, 5));
  }
  return result;
}

export type PaidDuplicateAlertLine = {
  key: string;
  text: string;
};

/** 同一組只列一次。只讀，沒有後續動作。 */
export function paidDuplicateAlertLines(
  peers: Map<string, PaidDuplicatePeer[]>,
  names: Map<string, string>,
  focusIds: Set<string>
): PaidDuplicateAlertLine[] {
  const seen = new Set<string>();
  const lines: PaidDuplicateAlertLine[] = [];
  for (const [id, peerList] of peers) {
    if (!focusIds.has(id)) continue;
    const left = names.get(id) || id;
    for (const peer of peerList) {
      const key = [id, peer.專案ID].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      const where = peer.paid ? "也在匯出清單" : "尚未進入匯出";
      lines.push({
        key,
        text: `「${left}」和「${peer.專案名稱}」名稱相近，對方${where}。`,
      });
    }
  }
  lines.sort((a, b) => a.text.localeCompare(b.text, "zh-Hant"));
  return lines;
}
