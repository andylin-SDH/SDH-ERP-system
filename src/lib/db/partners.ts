/**
 * Partners 資料層（Supabase）
 * 目前無「合作夥伴」表時一律回傳空陣列，不拋錯
 */

import { getSupabase } from "@/lib/supabase/server";
import type { PartnerRow } from "@/modules/partners/types";

function rowToPartner(r: Record<string, unknown>): PartnerRow {
  return {
    PartnerID: r.PartnerID as string,
    類別一: (r["類別一"] as string) || undefined,
    類別二: (r["類別二"] as string) || undefined,
    類別三: (r["類別三"] as string) || undefined,
    合作夥伴名稱: (r["合作夥伴名稱"] as string) || undefined,
    社群網站: (r["社群網站"] as string) || undefined,
    粉絲數: (r["粉絲數"] as string) || undefined,
    "頻道｜節目名稱": (r["頻道｜節目名稱"] as string) || undefined,
    "是否有經營 私域群": (r["是否有經營 私域群"] as boolean) ?? false,
    資料夾: (r["資料夾"] as string) || undefined,
    經紀人: (r["經紀人"] as string) || undefined,
    廣告經銷夥伴: (r["廣告經銷夥伴"] as boolean) ?? false,
    節目製作夥伴: (r["節目製作夥伴"] as boolean) ?? false,
    課程製作夥伴: (r["課程製作夥伴"] as boolean) ?? false,
    Email: (r.Email as string) || undefined,
    分級: (r["分級"] as string) || undefined,
  };
}

export interface NewPartnerInput {
  PartnerID: string;
  類別一?: string;
  類別二?: string;
  類別三?: string;
  合作夥伴名稱?: string;
  社群網站?: string;
  粉絲數?: string;
  "頻道｜節目名稱"?: string;
  "是否有經營 私域群"?: boolean;
  資料夾?: string;
  經紀人?: string;
  廣告經銷夥伴?: boolean;
  節目製作夥伴?: boolean;
  課程製作夥伴?: boolean;
  Email?: string;
  分級?: string;
}

export async function createPartner(payload: NewPartnerInput): Promise<PartnerRow> {
  const PartnerID = String(payload.PartnerID ?? "").trim();
  if (!PartnerID) {
    throw new Error("PartnerID 為必填");
  }

  const insert: Record<string, unknown> = {
    PartnerID,
    類別一: payload.類別一 ?? null,
    類別二: payload.類別二 ?? null,
    類別三: payload.類別三 ?? null,
    合作夥伴名稱: payload.合作夥伴名稱 ?? null,
    社群網站: payload.社群網站 ?? null,
    粉絲數: payload.粉絲數 ?? null,
    "頻道｜節目名稱": payload["頻道｜節目名稱"] ?? null,
    "是否有經營 私域群": Boolean(payload["是否有經營 私域群"]),
    資料夾: payload.資料夾 ?? null,
    經紀人: payload.經紀人 ?? null,
    廣告經銷夥伴: Boolean(payload.廣告經銷夥伴),
    節目製作夥伴: Boolean(payload.節目製作夥伴),
    課程製作夥伴: Boolean(payload.課程製作夥伴),
    Email: payload.Email ?? null,
    分級: payload.分級 ?? null,
  };

  const { data, error } = await getSupabase()
    .from("partners")
    .insert(insert)
    .select('"PartnerID", "類別一", "類別二", "類別三", "合作夥伴名稱", "社群網站", "粉絲數", "頻道｜節目名稱", "是否有經營 私域群", "資料夾", "經紀人", "廣告經銷夥伴", "節目製作夥伴", "課程製作夥伴", "Email", "分級"')
    .single();

  if (error || !data) {
    throw error ?? new Error("createPartner 失敗");
  }
  return rowToPartner(data as Record<string, unknown>);
}

export interface UpdatePartnerInput {
  類別一?: string;
  類別二?: string;
  類別三?: string;
  合作夥伴名稱?: string;
  社群網站?: string;
  粉絲數?: string;
  "頻道｜節目名稱"?: string;
  "是否有經營 私域群"?: boolean;
  資料夾?: string;
  經紀人?: string;
  廣告經銷夥伴?: boolean;
  節目製作夥伴?: boolean;
  課程製作夥伴?: boolean;
  Email?: string;
  分級?: string;
}

export async function updatePartner(PartnerID: string, payload: UpdatePartnerInput): Promise<PartnerRow | null> {
  const update: Record<string, unknown> = {};
  if (payload.類別一 !== undefined) update["類別一"] = payload.類別一 ?? null;
  if (payload.類別二 !== undefined) update["類別二"] = payload.類別二 ?? null;
  if (payload.類別三 !== undefined) update["類別三"] = payload.類別三 ?? null;
  if (payload.合作夥伴名稱 !== undefined) update["合作夥伴名稱"] = payload.合作夥伴名稱 ?? null;
  if (payload.社群網站 !== undefined) update["社群網站"] = payload.社群網站 ?? null;
  if (payload.粉絲數 !== undefined) update["粉絲數"] = payload.粉絲數 ?? null;
  if (payload["頻道｜節目名稱"] !== undefined) update["頻道｜節目名稱"] = payload["頻道｜節目名稱"] ?? null;
  if (payload["是否有經營 私域群"] !== undefined) update["是否有經營 私域群"] = Boolean(payload["是否有經營 私域群"]);
  if (payload.資料夾 !== undefined) update["資料夾"] = payload.資料夾 ?? null;
  if (payload.經紀人 !== undefined) update["經紀人"] = payload.經紀人 ?? null;
  if (payload.廣告經銷夥伴 !== undefined) update["廣告經銷夥伴"] = Boolean(payload.廣告經銷夥伴);
  if (payload.節目製作夥伴 !== undefined) update["節目製作夥伴"] = Boolean(payload.節目製作夥伴);
  if (payload.課程製作夥伴 !== undefined) update["課程製作夥伴"] = Boolean(payload.課程製作夥伴);
  if (payload.Email !== undefined) update["Email"] = payload.Email ?? null;
  if (payload.分級 !== undefined) update["分級"] = payload.分級 ?? null;

  if (Object.keys(update).length === 0) return null;

  const { data, error } = await getSupabase()
    .from("partners")
    .update(update)
    .eq("PartnerID", PartnerID)
    .select('"PartnerID", "類別一", "類別二", "類別三", "合作夥伴名稱", "社群網站", "粉絲數", "頻道｜節目名稱", "是否有經營 私域群", "資料夾", "經紀人", "廣告經銷夥伴", "節目製作夥伴", "課程製作夥伴", "Email", "分級"')
    .single();

  if (error || !data) return null;
  return rowToPartner(data as Record<string, unknown>);
}

export async function getPartners(): Promise<PartnerRow[]> {
  try {
    const { data, error } = await getSupabase()
      .from("partners")
      .select('"PartnerID", "類別一", "類別二", "類別三", "合作夥伴名稱", "社群網站", "粉絲數", "頻道｜節目名稱", "是否有經營 私域群", "資料夾", "經紀人", "廣告經銷夥伴", "節目製作夥伴", "課程製作夥伴", "Email", "分級"')
      .order("PartnerID");
    if (error) return [];
    return (data ?? []).map(rowToPartner);
  } catch {
    return [];
  }
}

export async function getPartnersByAgent(agentEmail: string): Promise<PartnerRow[]> {
  try {
    const { data, error } = await getSupabase()
      .from("partners")
      .select('"PartnerID", "類別一", "類別二", "類別三", "合作夥伴名稱", "社群網站", "粉絲數", "頻道｜節目名稱", "是否有經營 私域群", "資料夾", "經紀人", "廣告經銷夥伴", "節目製作夥伴", "課程製作夥伴", "Email", "分級"')
      .ilike("經紀人", agentEmail)
      .order("PartnerID");
    if (error) return [];
    return (data ?? []).map(rowToPartner);
  } catch {
    return [];
  }
}

export async function getPartnersByScope(scopeStr: string): Promise<PartnerRow[]> {
  const ids = scopeStr.split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) return [];
  try {
    const { data, error } = await getSupabase()
      .from("partners")
      .select('"PartnerID", "類別一", "類別二", "類別三", "合作夥伴名稱", "社群網站", "粉絲數", "頻道｜節目名稱", "是否有經營 私域群", "資料夾", "經紀人", "廣告經銷夥伴", "節目製作夥伴", "課程製作夥伴", "Email", "分級"')
      .in("PartnerID", ids)
      .order("PartnerID");
    if (error) return [];
    return (data ?? []).map(rowToPartner);
  } catch {
    return [];
  }
}

export async function getPartnersForAgent(
  agentEmail: string,
  scopeStr?: string
): Promise<PartnerRow[]> {
  const [byAgent, byScope] = await Promise.all([
    getPartnersByAgent(agentEmail),
    scopeStr?.trim() ? getPartnersByScope(scopeStr) : Promise.resolve([]),
  ]);
  const seen = new Set<string>();
  const merged: PartnerRow[] = [];
  for (const p of [...byAgent, ...byScope]) {
    const key = p.PartnerID ?? p.合作夥伴名稱 ?? "";
    if (key && !seen.has(key)) {
      seen.add(key);
      merged.push(p);
    }
  }
  return merged;
}
