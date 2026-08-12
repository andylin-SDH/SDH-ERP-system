import type { PartnerRow } from "@/modules/partners";

export type KolCatalogItem = {
  id: string;
  name: string;
  category1: string;
  category2: string;
  category3: string;
  avatarUrl: string;
  channelName: string;
  followers: string;
  socialUrls: string;
};

function formatFollowers(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const n = Number(s.replace(/,/g, ""));
  if (Number.isFinite(n) && n >= 10000) return `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)} 萬`;
  return s;
}

export function partnerToCatalogItem(row: PartnerRow): KolCatalogItem | null {
  const name = String(row.合作夥伴名稱 ?? "").trim();
  const id = String(row.PartnerID ?? "").trim();
  if (!name) return null;

  return {
    id: id || name,
    name,
    category1: String(row.類別一 ?? "").trim(),
    category2: String(row.類別二 ?? "").trim(),
    category3: String(row.類別三 ?? "").trim(),
    avatarUrl: String(row.形象照 ?? "").trim(),
    channelName: String(row["頻道｜節目名稱"] ?? "").trim(),
    followers: formatFollowers(row.粉絲數),
    socialUrls: String(row.社群網站 ?? "").trim(),
  };
}

export function buildKolCatalogItems(partners: PartnerRow[]): KolCatalogItem[] {
  return partners
    .map(partnerToCatalogItem)
    .filter((x): x is KolCatalogItem => x != null)
    .sort(
      (a, b) =>
        a.category1.localeCompare(b.category1, "zh-TW") ||
        a.name.localeCompare(b.name, "zh-TW")
    );
}

export function catalogCategoryTabs(items: KolCatalogItem[]): { key: string; label: string; count: number }[] {
  const map = new Map<string, number>();
  for (const item of items) {
    const k = item.category1 || "未分類";
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  const tabs = [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "zh-TW"))
    .map(([key, count]) => ({ key, label: key, count }));
  return [{ key: "all", label: "全部", count: items.length }, ...tabs];
}

/** 依手動選定的 PartnerID 組封面圖；不足時用該類有形象照的 KOL 補齊（最多 3） */
export function resolveCategoryCoverAvatars(
  items: KolCatalogItem[],
  categoryKey: string,
  preferredPartnerIds: string[] | undefined
): string[] {
  const inCat = items.filter((i) => (i.category1 || "未分類") === categoryKey);
  const byId = new Map(inCat.map((i) => [i.id, i]));
  const out: string[] = [];
  const used = new Set<string>();

  for (const id of preferredPartnerIds ?? []) {
    const hit = byId.get(String(id).trim());
    if (!hit?.avatarUrl || used.has(hit.id)) continue;
    out.push(hit.avatarUrl);
    used.add(hit.id);
    if (out.length >= 3) return out;
  }

  for (const i of inCat) {
    if (!i.avatarUrl || used.has(i.id)) continue;
    out.push(i.avatarUrl);
    used.add(i.id);
    if (out.length >= 3) break;
  }
  return out;
}
