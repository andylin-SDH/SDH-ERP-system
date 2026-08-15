/**
 * Partners 資料層（Supabase）
 * 查詢失敗時改為回傳錯誤訊息（供 API 顯示），並可 fallback select('*') 以相容舊表結構
 */

import { getSupabase } from "@/lib/supabase/server";
import { log } from "@/lib/log";
import type { PartnerRow } from "@/modules/partners/types";
import {
  buildPartnerChangeDiff,
  insertPartnerEditLog,
  PARTNER_EDIT_ACTION,
  updatePayloadToRecord,
} from "@/lib/db/partner-edit-log";

/** 與目前 DB 中文欄位一致；若任一名稱不符 PostgREST 會整段失敗 */
const PARTNER_SELECT =
  '"PartnerID", "類別一", "類別二", "類別三", "合作夥伴名稱", "社群網站", "粉絲數", "頻道｜節目名稱", "是否有經營 私域群", "資料夾", "KOL開發者", "主管", "經銷約開始日", "自來件分潤", "SDH開發分件分潤", "經銷約結束日", "廣告經銷夥伴", "節目製作夥伴", "課程製作夥伴", "Email", "分級", "形象照", "建立者", "最後更新者", "最後更新時間"';

function rowToPartner(r: Record<string, unknown>): PartnerRow {
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
    "是否有經營 私域群": normalizePartnerBoolean(r["是否有經營 私域群"]),
    資料夾: (r["資料夾"] as string) || undefined,
    KOL開發者: (r["KOL開發者"] as string) || undefined,
    主管: (r["主管"] as string) || undefined,
    經銷約開始日: (r["經銷約開始日"] as string) || undefined,
    自來件分潤: (r["自來件分潤"] as string) || undefined,
    "SDH開發分件分潤": (r["SDH開發分件分潤"] as string) || undefined,
    經銷約結束日: (r["經銷約結束日"] as string) || undefined,
    廣告經銷夥伴: normalizePartnerBoolean(r["廣告經銷夥伴"]),
    節目製作夥伴: normalizePartnerBoolean(r["節目製作夥伴"]),
    課程製作夥伴: normalizePartnerBoolean(r["課程製作夥伴"]),
    Email: (r.Email as string) || undefined,
    分級: (r["分級"] as string) || undefined,
    形象照: (r["形象照"] as string) || undefined,
    建立者: (r["建立者"] as string) || undefined,
    最後更新者: (r["最後更新者"] as string) || undefined,
    最後更新時間: (r["最後更新時間"] as string) || undefined,
    deleted_at: (r.deleted_at as string) || null,
    deleted_by: (r.deleted_by as string) || null,
    delete_reason: (r.delete_reason as string) || null,
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
  KOL開發者?: string;
  主管?: string;
  經銷約開始日?: string;
  自來件分潤?: string;
  "SDH開發分件分潤"?: string;
  經銷約結束日?: string;
  廣告經銷夥伴?: boolean;
  節目製作夥伴?: boolean;
  課程製作夥伴?: boolean;
  Email?: string;
  分級?: string;
}

export interface CreatePartnerOptions {
  /** 建立者（姓名或 email） */
  建立者?: string | null;
}

import {
  findPartnerDuplicateInList,
  type PartnerDuplicateMatch,
} from "@/lib/partners/duplicate";
import { normalizePartnerBoolean } from "@/lib/partners/boolean";

export {
  findPartnerDuplicateInList,
  formatPartnerDuplicateError,
  type PartnerDuplicateMatch,
} from "@/lib/partners/duplicate";

export async function findPartnerDuplicate(input: {
  合作夥伴名稱?: string;
  Email?: string;
  excludePartnerId?: string;
}): Promise<PartnerDuplicateMatch | null> {
  const { partners } = await getPartnersWithError();
  return findPartnerDuplicateInList(partners, input);
}

function partnerCreateSnapshot(payload: NewPartnerInput): Record<string, unknown> {
  return updatePayloadToRecord(payload as UpdatePartnerInput);
}

export async function createPartner(
  payload: NewPartnerInput,
  options?: CreatePartnerOptions
): Promise<PartnerRow> {
  const PartnerID = String(payload.PartnerID ?? "").trim();
  if (!PartnerID) {
    throw new Error("PartnerID 為必填");
  }

  const editor = options?.建立者 ?? null;
  const now = new Date().toISOString();

  const insert: Record<string, unknown> = {
    PartnerID,
    類別一: payload.類別一 ?? null,
    類別二: payload.類別二 ?? null,
    類別三: payload.類別三 ?? null,
    合作夥伴名稱: payload.合作夥伴名稱 ?? null,
    社群網站: payload.社群網站 ?? null,
    粉絲數: payload.粉絲數 ?? null,
    "頻道｜節目名稱": payload["頻道｜節目名稱"] ?? null,
    "是否有經營 私域群": normalizePartnerBoolean(payload["是否有經營 私域群"]),
    資料夾: payload.資料夾 ?? null,
    KOL開發者: payload.KOL開發者 ?? null,
    主管: payload.主管 ?? null,
    經銷約開始日: payload.經銷約開始日 ?? null,
    自來件分潤: payload.自來件分潤 ?? null,
    "SDH開發分件分潤": payload["SDH開發分件分潤"] ?? null,
    經銷約結束日: payload.經銷約結束日 ?? null,
    廣告經銷夥伴: normalizePartnerBoolean(payload.廣告經銷夥伴),
    節目製作夥伴: normalizePartnerBoolean(payload.節目製作夥伴),
    課程製作夥伴: normalizePartnerBoolean(payload.課程製作夥伴),
    Email: payload.Email ?? null,
    分級: payload.分級 ?? null,
    建立者: editor,
    最後更新者: editor,
    最後更新時間: now,
  };

  const { data, error } = await getSupabase()
    .from("partners")
    .insert(insert)
    .select(PARTNER_SELECT)
    .single();

  if (error || !data) {
    throw error ?? new Error("createPartner 失敗");
  }

  const partner = rowToPartner(data as Record<string, unknown>);
  if (editor) {
    await insertPartnerEditLog({
      PartnerID,
      操作: PARTNER_EDIT_ACTION.CREATE,
      更新者: editor,
      變更內容: partnerCreateSnapshot(payload),
    });
  }
  return partner;
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
  KOL開發者?: string;
  主管?: string;
  經銷約開始日?: string;
  自來件分潤?: string;
  "SDH開發分件分潤"?: string;
  經銷約結束日?: string;
  廣告經銷夥伴?: boolean;
  節目製作夥伴?: boolean;
  課程製作夥伴?: boolean;
  Email?: string;
  分級?: string;
  形象照?: string | null;
  最後更新者?: string | null;
  最後更新時間?: string | null;
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
  if (payload["是否有經營 私域群"] !== undefined) {
    update["是否有經營 私域群"] = normalizePartnerBoolean(payload["是否有經營 私域群"]);
  }
  if (payload.資料夾 !== undefined) update["資料夾"] = payload.資料夾 ?? null;
  if (payload.KOL開發者 !== undefined) update["KOL開發者"] = payload.KOL開發者 ?? null;
  if (payload.主管 !== undefined) update["主管"] = payload.主管 ?? null;
  if (payload.經銷約開始日 !== undefined) update["經銷約開始日"] = payload.經銷約開始日 ?? null;
  if (payload.自來件分潤 !== undefined) update["自來件分潤"] = payload.自來件分潤 ?? null;
  if (payload["SDH開發分件分潤"] !== undefined) update["SDH開發分件分潤"] = payload["SDH開發分件分潤"] ?? null;
  if (payload.經銷約結束日 !== undefined) update["經銷約結束日"] = payload.經銷約結束日 ?? null;
  if (payload.廣告經銷夥伴 !== undefined) update["廣告經銷夥伴"] = normalizePartnerBoolean(payload.廣告經銷夥伴);
  if (payload.節目製作夥伴 !== undefined) update["節目製作夥伴"] = normalizePartnerBoolean(payload.節目製作夥伴);
  if (payload.課程製作夥伴 !== undefined) update["課程製作夥伴"] = normalizePartnerBoolean(payload.課程製作夥伴);
  if (payload.Email !== undefined) update["Email"] = payload.Email ?? null;
  if (payload.分級 !== undefined) update["分級"] = payload.分級 ?? null;
  if (payload.形象照 !== undefined) update["形象照"] = payload.形象照 ?? null;
  if (payload.最後更新者 !== undefined) update["最後更新者"] = payload.最後更新者 ?? null;
  if (payload.最後更新時間 !== undefined) update["最後更新時間"] = payload.最後更新時間 ?? null;

  if (Object.keys(update).length === 0) return null;

  const { data, error } = await getSupabase()
    .from("partners")
    .update(update)
    .eq("PartnerID", PartnerID)
    .select(PARTNER_SELECT)
    .single();

  if (error) {
    log("partners.db", "updatePartner 更新失敗", { PartnerID, error: String(error?.message) });
    return null;
  }
  if (!data) return null;
  return rowToPartner(data as Record<string, unknown>);
}

/** 更新 KOL 並寫入 edit log（僅在有欄位變更時） */
export async function updatePartnerWithEditLog(
  PartnerID: string,
  existing: PartnerRow,
  payload: UpdatePartnerInput,
  editor: string
): Promise<{ partner: PartnerRow | null; noChanges?: boolean }> {
  const diff = buildPartnerChangeDiff(existing, updatePayloadToRecord(payload));
  if (!diff) return { partner: existing, noChanges: true };

  const now = new Date().toISOString();
  const partner = await updatePartner(PartnerID, {
    ...payload,
    最後更新者: editor,
    最後更新時間: now,
  });
  if (!partner) return { partner: null };

  await insertPartnerEditLog({
    PartnerID,
    操作: PARTNER_EDIT_ACTION.UPDATE,
    更新者: editor,
    變更內容: diff.變更內容,
    變更前快照: diff.變更前快照,
  });
  return { partner };
}

export async function softDeletePartner(
  PartnerID: string,
  editor: string,
  reason?: string | null
): Promise<{ ok: boolean; error?: string; alreadyDeleted?: boolean }> {
  const pid = String(PartnerID ?? "").trim();
  if (!pid) return { ok: false, error: "PartnerID 為必填" };

  const existing = await getPartnerById(pid, { includeDeleted: true });
  if (!existing) return { ok: false, error: "找不到該合作夥伴" };
  if (existing.deleted_at) return { ok: true, alreadyDeleted: true };

  const now = new Date().toISOString();
  const snapshot = { ...(existing as unknown as Record<string, unknown>) };
  delete snapshot.deleted_at;
  delete snapshot.deleted_by;
  delete snapshot.delete_reason;

  const { error } = await getSupabase()
    .from("partners")
    .update({
      deleted_at: now,
      deleted_by: editor || null,
      delete_reason: reason?.trim() || null,
      最後更新者: editor || null,
      最後更新時間: now,
    })
    .eq("PartnerID", pid)
    .is("deleted_at", null);

  if (error) {
    const msg = error.message ?? String(error);
    if (/deleted_at|schema cache|column/i.test(msg)) {
      return {
        ok: false,
        error: "資料庫尚未啟用軟刪欄位，請先執行 migration 066_soft_delete_partners_master.sql",
      };
    }
    return { ok: false, error: msg };
  }

  await insertPartnerEditLog({
    PartnerID: pid,
    操作: PARTNER_EDIT_ACTION.DELETE,
    更新者: editor || "系統",
    變更內容: { deleted_at: now, ...(reason?.trim() ? { delete_reason: reason.trim() } : {}) },
    變更前快照: snapshot,
  });
  return { ok: true };
}

/** @deprecated 請改用 softDeletePartner；保留名稱相容舊呼叫 */
export async function deletePartner(PartnerID: string, editor = "系統"): Promise<boolean> {
  const r = await softDeletePartner(PartnerID, editor);
  return r.ok;
}

export async function restorePartner(
  PartnerID: string,
  editor: string
): Promise<{ ok: boolean; error?: string; partner?: PartnerRow }> {
  const pid = String(PartnerID ?? "").trim();
  if (!pid) return { ok: false, error: "PartnerID 為必填" };

  const existing = await getPartnerById(pid, { includeDeleted: true });
  if (!existing) return { ok: false, error: "找不到該合作夥伴" };
  if (!existing.deleted_at) return { ok: true, partner: existing };

  const now = new Date().toISOString();
  const { error } = await getSupabase()
    .from("partners")
    .update({
      deleted_at: null,
      deleted_by: null,
      delete_reason: null,
      最後更新者: editor || null,
      最後更新時間: now,
    })
    .eq("PartnerID", pid);

  if (error) {
    const msg = error.message ?? String(error);
    if (/deleted_at|schema cache|column/i.test(msg)) {
      return {
        ok: false,
        error: "資料庫尚未啟用軟刪欄位，請先執行 migration 066_soft_delete_partners_master.sql",
      };
    }
    return { ok: false, error: msg };
  }

  await insertPartnerEditLog({
    PartnerID: pid,
    操作: PARTNER_EDIT_ACTION.RESTORE,
    更新者: editor || "系統",
    變更內容: { deleted_at: null },
    變更前快照: { deleted_at: existing.deleted_at, deleted_by: existing.deleted_by },
  });

  const partner = await getPartnerById(pid);
  return { ok: true, partner: partner ?? undefined };
}

export interface GetPartnersResult {
  partners: PartnerRow[];
  error: string | null;
  usedFallback?: boolean;
}

/** 主列表用；函式名保留以相容 gallery 等呼叫端 */
export async function getPartnersApprovedWithError(): Promise<GetPartnersResult> {
  return getPartnersWithError();
}

function filterOutDeletedPartners(partners: PartnerRow[]): PartnerRow[] {
  return partners.filter((p) => !p.deleted_at);
}

export async function getPartnersWithError(): Promise<GetPartnersResult> {
  const supabase = getSupabase();
  try {
    const withSoft = await supabase
      .from("partners")
      .select("*")
      .is("deleted_at", null)
      .order("PartnerID");
    if (!withSoft.error && withSoft.data) {
      const partners = (withSoft.data as unknown as Record<string, unknown>[]).map(rowToPartner);
      log("partners.db", "getPartners 筆數", { count: partners.length });
      return { partners, error: null };
    }

    const softMsg = withSoft.error?.message ?? "";
    const softMissing = /deleted_at|schema cache|column/i.test(softMsg);

    const { data, error } = await supabase.from("partners").select(PARTNER_SELECT).order("PartnerID");
    if (!error && data) {
      const partners = filterOutDeletedPartners(
        (data as unknown as Record<string, unknown>[]).map(rowToPartner)
      );
      log("partners.db", "getPartners 筆數", {
        count: partners.length,
        softFilterSkipped: softMissing,
      });
      return { partners, error: null };
    }
    const msg = error?.message ?? softMsg ?? String(error);
    log("partners.db", "getPartners 精確欄位查詢失敗，嘗試 select *", { error: msg });

    const { data: raw, error: err2 } = await supabase.from("partners").select("*").limit(2000);
    if (err2) {
      log("partners.db", "getPartners fallback 也失敗", { error: String(err2.message) });
      return { partners: [], error: msg || err2.message };
    }
    const rows = filterOutDeletedPartners((raw ?? []).map((r) => rowToPartner(r as Record<string, unknown>)));
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

export async function getPartners(): Promise<PartnerRow[]> {
  const { partners } = await getPartnersWithError();
  return partners;
}

export async function getPartnerById(
  PartnerID: string,
  options?: { includeDeleted?: boolean }
): Promise<PartnerRow | null> {
  const pid = String(PartnerID ?? "").trim();
  if (!pid) return null;
  try {
    let q = getSupabase().from("partners").select("*").eq("PartnerID", pid);
    if (!options?.includeDeleted) q = q.is("deleted_at", null);
    let { data, error } = await q.maybeSingle();
    if (error && /deleted_at|schema cache|column/i.test(error.message ?? "")) {
      ({ data, error } = await getSupabase()
        .from("partners")
        .select(PARTNER_SELECT)
        .eq("PartnerID", pid)
        .maybeSingle());
    }
    if (error || !data) return null;
    const row = rowToPartner(data as unknown as Record<string, unknown>);
    if (!options?.includeDeleted && row.deleted_at) return null;
    return row;
  } catch {
    return null;
  }
}

export async function getPartnersByAgent(agentEmail: string): Promise<PartnerRow[]> {
  void agentEmail;
  return [];
}

export async function getPartnersByScope(scopeStr: string): Promise<PartnerRow[]> {
  const ids = scopeStr.split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) return [];
  try {
    const withSoft = await getSupabase()
      .from("partners")
      .select("*")
      .in("PartnerID", ids)
      .is("deleted_at", null)
      .order("PartnerID");
    if (!withSoft.error && withSoft.data) {
      return (withSoft.data as unknown as Record<string, unknown>[]).map(rowToPartner);
    }
    const { data, error } = await getSupabase()
      .from("partners")
      .select(PARTNER_SELECT)
      .in("PartnerID", ids)
      .order("PartnerID");
    if (error) return [];
    return filterOutDeletedPartners((data as unknown as Record<string, unknown>[]).map(rowToPartner));
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

const KOL_ID_REGEX = /^KOL-(\d+)$/i;

export async function getNextPartnerId(): Promise<string> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.from("partners").select("PartnerID");
    if (error || !data) return "KOL-001";
    let max = 0;
    for (const row of data as { PartnerID?: string }[]) {
      const id = String(row.PartnerID ?? "").trim();
      const m = id.match(KOL_ID_REGEX);
      if (m) {
        const n = parseInt(m[1], 10);
        if (!Number.isNaN(n) && n > max) max = n;
      }
    }
    const next = max + 1;
    return `KOL-${String(next).padStart(3, "0")}`;
  } catch {
    return "KOL-001";
  }
}

export async function getPartnerCategoryOptions(): Promise<{
  類別一: string[];
  類別二: string[];
  類別三: string[];
}> {
  const empty = { 類別一: [] as string[], 類別二: [] as string[], 類別三: [] as string[] };
  try {
    const supabase = getSupabase();
    let data: Record<string, unknown>[] | null = null;
    const { data: dataCols, error } = await supabase
      .from("partners")
      .select('"類別一","類別二","類別三"')
      .limit(3000);
    if (!error && dataCols) {
      data = dataCols as Record<string, unknown>[];
    } else {
      const { partners } = await getPartnersWithError();
      data = partners.map((p) => ({
        類別一: p.類別一,
        類別二: p.類別二,
        類別三: p.類別三,
      }));
    }
    if (!data?.length) return empty;
    const s1 = new Set<string>();
    const s2 = new Set<string>();
    const s3 = new Set<string>();
    for (const row of data) {
      const v1 = String(row["類別一"] ?? "").trim();
      const v2 = String(row["類別二"] ?? "").trim();
      const v3 = String(row["類別三"] ?? "").trim();
      if (v1) s1.add(v1);
      if (v2) s2.add(v2);
      if (v3) s3.add(v3);
    }
    const sort = (a: string, b: string) => a.localeCompare(b, "zh-Hant");
    return {
      類別一: [...s1].sort(sort),
      類別二: [...s2].sort(sort),
      類別三: [...s3].sort(sort),
    };
  } catch {
    return empty;
  }
}
