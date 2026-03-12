/**
 * Partners 資料層（Supabase）
 * 查詢失敗時改為回傳錯誤訊息（供 API 顯示），並可 fallback select('*') 以相容舊表結構
 */

import { getSupabase } from "@/lib/supabase/server";
import { log } from "@/lib/log";
import type { PartnerRow } from "@/modules/partners/types";

/** 與目前 DB 中文欄位一致；若任一名稱不符 PostgREST 會整段失敗 */
const PARTNER_SELECT =
  '"PartnerID", "類別一", "類別二", "類別三", "合作夥伴名稱", "社群網站", "粉絲數", "頻道｜節目名稱", "是否有經營 私域群", "資料夾", "經紀人", "KOL開發者", "廣告經銷夥伴", "節目製作夥伴", "課程製作夥伴", "Email", "分級"';

function rowToPartner(r: Record<string, unknown>): PartnerRow {
  // 舊表 partners（migration 000）為 partner_id / partner_name 等，一併對應
  const PartnerID =
    (r.PartnerID as string) ||
    (r.partner_id as string) ||
    (r["PartnerID"] as string) ||
    undefined;
  return {
    PartnerID,
    類別一: (r["類別一"] as string) || undefined,
    類別二: (r["類別二"] as string) || undefined,
    類別三: (r["類別三"] as string) || undefined,
    合作夥伴名稱:
      (r["合作夥伴名稱"] as string) || (r.partner_name as string) || undefined,
    社群網站: (r["社群網站"] as string) || undefined,
    粉絲數: (r["粉絲數"] as string) || undefined,
    "頻道｜節目名稱": (r["頻道｜節目名稱"] as string) || undefined,
    "是否有經營 私域群": (r["是否有經營 私域群"] as boolean) ?? false,
    資料夾: (r["資料夾"] as string) || undefined,
    經紀人:
      (r["經紀人"] as string) || (r.responsible_agent as string) || undefined,
    KOL開發者: (r["KOL開發者"] as string) || undefined,
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
  KOL開發者?: string;
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
    KOL開發者: payload.KOL開發者 ?? null,
    廣告經銷夥伴: Boolean(payload.廣告經銷夥伴),
    節目製作夥伴: Boolean(payload.節目製作夥伴),
    課程製作夥伴: Boolean(payload.課程製作夥伴),
    Email: payload.Email ?? null,
    分級: payload.分級 ?? null,
  };

  const { data, error } = await getSupabase()
    .from("partners")
    .insert(insert)
    .select(PARTNER_SELECT)
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
  KOL開發者?: string;
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
  if (payload.KOL開發者 !== undefined) update["KOL開發者"] = payload.KOL開發者 ?? null;
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
    .select(PARTNER_SELECT)
    .single();

  if (error || !data) return null;
  return rowToPartner(data as Record<string, unknown>);
}

export interface GetPartnersResult {
  partners: PartnerRow[];
  /** 非 null 表示精確欄位 select 失敗；可能已用 select('*') fallback */
  error: string | null;
  /** true 表示有使用 fallback，欄位可能不完整 */
  usedFallback?: boolean;
}

/**
 * 取得合作夥伴列表；失敗時回傳 error 字串，並嘗試 select('*') 以相容欄位名不同的表
 */
export async function getPartnersWithError(): Promise<GetPartnersResult> {
  const supabase = getSupabase();
  try {
    const { data, error } = await supabase
      .from("partners")
      .select(PARTNER_SELECT)
      .order("PartnerID");
    if (!error && data) {
      const partners = data.map(rowToPartner);
      log("partners.db", "getPartners 筆數", { count: partners.length });
      return { partners, error: null };
    }
    const msg = error?.message ?? String(error);
    log("partners.db", "getPartners 精確欄位查詢失敗，嘗試 select *", { error: msg });

    const { data: raw, error: err2 } = await supabase.from("partners").select("*").limit(2000);
    if (err2) {
      log("partners.db", "getPartners fallback 也失敗", { error: String(err2.message) });
      return { partners: [], error: msg || err2.message };
    }
    const rows = (raw ?? []).map((r) => rowToPartner(r as Record<string, unknown>));
    log("partners.db", "getPartners fallback 筆數", { count: rows.length, firstError: msg });
    return {
      partners: rows,
      error: `欄位清單查詢失敗已改用全欄位：${msg}`,
      usedFallback: true,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("partners.db", "getPartners 例外", { error: msg });
    return { partners: [], error: msg };
  }
}

/** 向後相容：只取列表時仍可用；建議 API 改用 getPartnersWithError 以便除錯 */
export async function getPartners(): Promise<PartnerRow[]> {
  const { partners } = await getPartnersWithError();
  return partners;
}

export async function getPartnersByAgent(agentEmail: string): Promise<PartnerRow[]> {
  try {
    const { data, error } = await getSupabase()
      .from("partners")
      .select(PARTNER_SELECT)
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
      .select(PARTNER_SELECT)
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
