import type { PartnerRow } from "@/modules/partners";
import { normalizePartnerBoolean } from "@/lib/partners/boolean";
import { parseSocialUrls, getPlatform } from "@/lib/utils/social-urls";

const PLATFORM_LABEL: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  youtube: "YouTube",
  line: "LINE",
  linkedin: "LinkedIn",
  twitter: "X",
  link: "連結",
};

export type KolCatalogItem = {
  id: string;
  name: string;
  category1: string;
  category2: string;
  category3: string;
  avatarUrl: string;
  channelName: string;
  followers: string;
  platforms: string[];
  capabilities: string[];
  hasPrivateCommunity: boolean;
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

  const capabilities: string[] = [];
  if (normalizePartnerBoolean(row.廣告經銷夥伴)) capabilities.push("廣告業配");
  if (normalizePartnerBoolean(row.節目製作夥伴)) capabilities.push("節目製作");
  if (normalizePartnerBoolean(row.課程製作夥伴)) capabilities.push("課程製作");

  const platforms = [
    ...new Set(
      parseSocialUrls(row.社群網站)
        .map((url) => PLATFORM_LABEL[getPlatform(url)] ?? "社群")
        .filter(Boolean)
    ),
  ];

  return {
    id: id || name,
    name,
    category1: String(row.類別一 ?? "").trim(),
    category2: String(row.類別二 ?? "").trim(),
    category3: String(row.類別三 ?? "").trim(),
    avatarUrl: String(row.形象照 ?? "").trim(),
    channelName: String(row["頻道｜節目名稱"] ?? "").trim(),
    followers: formatFollowers(row.粉絲數),
    platforms,
    capabilities,
    hasPrivateCommunity: normalizePartnerBoolean(row["是否有經營 私域群"]),
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
