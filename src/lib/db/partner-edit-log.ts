/**
 * KOL 編輯歷史（partner_edit_log）
 */

import { getSupabase } from "@/lib/supabase/server";
import { log } from "@/lib/log";
import type { PartnerRow } from "@/modules/partners/types";
import type { UpdatePartnerInput } from "@/lib/db/partners";
import { isPartnerBooleanFieldKey, normalizePartnerBoolean } from "@/lib/partners/boolean";

export const PARTNER_EDIT_ACTION = {
  CREATE: "新增",
  UPDATE: "編輯",
  DELETE: "刪除",
} as const;

export type PartnerEditAction = (typeof PARTNER_EDIT_ACTION)[keyof typeof PARTNER_EDIT_ACTION];

export interface PartnerEditLogRow {
  id: string;
  PartnerID: string;
  操作: string;
  更新者: string;
  變更內容: Record<string, unknown>;
  變更前快照?: Record<string, unknown>;
  created_at?: string;
}

function rowToEditLog(r: Record<string, unknown>): PartnerEditLogRow {
  return {
    id: String(r.id ?? ""),
    PartnerID: String(r.PartnerID ?? r["PartnerID"] ?? ""),
    操作: String(r["操作"] ?? PARTNER_EDIT_ACTION.UPDATE),
    更新者: String(r["更新者"] ?? ""),
    變更內容: (r["變更內容"] as Record<string, unknown>) ?? {},
    變更前快照: (r["變更前快照"] as Record<string, unknown>) ?? undefined,
    created_at: r.created_at as string | undefined,
  };
}

function valuesEqual(key: string, a: unknown, b: unknown): boolean {
  if (isPartnerBooleanFieldKey(key)) {
    return normalizePartnerBoolean(a) === normalizePartnerBoolean(b);
  }
  const sa = a === undefined || a === null ? "" : String(a).trim();
  const sb = b === undefined || b === null ? "" : String(b).trim();
  return sa === sb;
}

/** 比對 payload 與現有列，回傳有差異的欄位 */
export function buildPartnerChangeDiff(
  existing: PartnerRow,
  payload: Record<string, unknown>
): { 變更內容: Record<string, unknown>; 變更前快照: Record<string, unknown> } | null {
  const 變更內容: Record<string, unknown> = {};
  const 變更前快照: Record<string, unknown> = {};
  const p = existing as unknown as Record<string, unknown>;
  for (const [key, newVal] of Object.entries(payload)) {
    const oldVal = p[key];
    if (!valuesEqual(key, oldVal, newVal)) {
      變更內容[key] = newVal;
      變更前快照[key] = oldVal ?? null;
    }
  }
  if (Object.keys(變更內容).length === 0) return null;
  return { 變更內容, 變更前快照 };
}

export async function insertPartnerEditLog(input: {
  PartnerID: string;
  操作: PartnerEditAction;
  更新者: string;
  變更內容: Record<string, unknown>;
  變更前快照?: Record<string, unknown> | null;
}): Promise<PartnerEditLogRow | null> {
  const supabase = getSupabase();
  try {
    const { data, error } = await supabase
      .from("partner_edit_log")
      .insert({
        PartnerID: input.PartnerID,
        操作: input.操作,
        更新者: input.更新者,
        變更內容: input.變更內容 as object,
        變更前快照: input.變更前快照 ?? null,
      })
      .select("*")
      .maybeSingle();
    if (error || !data) {
      log("partner_edit_log", "insert 失敗", { error: error?.message });
      return null;
    }
    return rowToEditLog(data as Record<string, unknown>);
  } catch (e) {
    log("partner_edit_log", "insert 例外", { error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

export async function listPartnerEditLogs(PartnerID: string, limit = 50): Promise<PartnerEditLogRow[]> {
  const pid = String(PartnerID ?? "").trim();
  if (!pid) return [];
  const supabase = getSupabase();
  try {
    const { data, error } = await supabase
      .from("partner_edit_log")
      .select("*")
      .eq("PartnerID", pid)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return (data as Record<string, unknown>[]).map(rowToEditLog);
  } catch {
    return [];
  }
}

export async function deletePartnerEditLogs(PartnerID: string): Promise<void> {
  const pid = String(PartnerID ?? "").trim();
  if (!pid) return;
  await getSupabase().from("partner_edit_log").delete().eq("PartnerID", pid);
}

/** 將 UpdatePartnerInput 轉成 plain record 供 diff */
export function updatePayloadToRecord(payload: UpdatePartnerInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}
