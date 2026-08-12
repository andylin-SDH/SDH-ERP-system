/**
 * 大總表編輯歷史（master_edit_log）
 */

import { getSupabase } from "@/lib/supabase/server";
import { log } from "@/lib/log";
import { normalizeDecimalString } from "@/lib/number-normalize";
import type { MasterRow, UpdateMasterInput, NewMasterInput } from "@/lib/db/master";
import { MASTER_AMOUNT_FIELD_KEYS } from "@/config/master-permissions";

export const MASTER_EDIT_ACTION = {
  CREATE: "新增",
  UPDATE: "編輯",
  DELETE: "刪除",
} as const;

export type MasterEditAction = (typeof MASTER_EDIT_ACTION)[keyof typeof MASTER_EDIT_ACTION];

export interface MasterEditLogRow {
  id: string;
  專案ID: string;
  操作: string;
  更新者: string;
  變更內容: Record<string, unknown>;
  變更前快照?: Record<string, unknown>;
  created_at?: string;
}

const AMOUNT_KEY_SET = new Set<string>(MASTER_AMOUNT_FIELD_KEYS);

function rowToEditLog(r: Record<string, unknown>): MasterEditLogRow {
  return {
    id: String(r.id ?? ""),
    專案ID: String(r["專案ID"] ?? ""),
    操作: String(r["操作"] ?? MASTER_EDIT_ACTION.UPDATE),
    更新者: String(r["更新者"] ?? ""),
    變更內容: (r["變更內容"] as Record<string, unknown>) ?? {},
    變更前快照: (r["變更前快照"] as Record<string, unknown>) ?? undefined,
    created_at: r.created_at as string | undefined,
  };
}

function valuesEqual(key: string, a: unknown, b: unknown): boolean {
  if (AMOUNT_KEY_SET.has(key)) {
    const na = normalizeDecimalString(a, 2) ?? "";
    const nb = normalizeDecimalString(b, 2) ?? "";
    return na === nb;
  }
  if (typeof a === "boolean" || typeof b === "boolean") {
    return Boolean(a) === Boolean(b);
  }
  const sa = a === undefined || a === null ? "" : String(a).trim();
  const sb = b === undefined || b === null ? "" : String(b).trim();
  return sa === sb;
}

/** 比對 payload 與現有列，回傳有差異的欄位 */
export function buildMasterChangeDiff(
  existing: MasterRow,
  payload: Record<string, unknown>
): { 變更內容: Record<string, unknown>; 變更前快照: Record<string, unknown> } | null {
  const 變更內容: Record<string, unknown> = {};
  const 變更前快照: Record<string, unknown> = {};
  const p = existing as unknown as Record<string, unknown>;
  for (const [key, newVal] of Object.entries(payload)) {
    if (key === "id" || key === "created_at" || key === "updated_at" || key === "專案ID") continue;
    const oldVal = p[key];
    if (!valuesEqual(key, oldVal, newVal)) {
      變更內容[key] = newVal;
      變更前快照[key] = oldVal ?? null;
    }
  }
  if (Object.keys(變更內容).length === 0) return null;
  return { 變更內容, 變更前快照 };
}

export function updateMasterPayloadToRecord(payload: UpdateMasterInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (k === "id") continue;
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export function masterCreateSnapshot(payload: NewMasterInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (v !== undefined && v !== null && String(v).trim() !== "") out[k] = v;
  }
  return out;
}

export function masterEditHasAmountChange(變更內容: Record<string, unknown> | null | undefined): boolean {
  if (!變更內容) return false;
  return MASTER_AMOUNT_FIELD_KEYS.some((k) => Object.prototype.hasOwnProperty.call(變更內容, k));
}

export async function insertMasterEditLog(input: {
  專案ID: string;
  操作: MasterEditAction;
  更新者: string;
  變更內容: Record<string, unknown>;
  變更前快照?: Record<string, unknown> | null;
}): Promise<MasterEditLogRow | null> {
  const 專案ID = String(input.專案ID ?? "").trim();
  if (!專案ID) return null;
  const supabase = getSupabase();
  try {
    const { data, error } = await supabase
      .from("master_edit_log")
      .insert({
        專案ID,
        操作: input.操作,
        更新者: input.更新者,
        變更內容: input.變更內容 as object,
        變更前快照: input.變更前快照 ?? null,
      })
      .select("*")
      .maybeSingle();
    if (error || !data) {
      log("master_edit_log", "insert 失敗", { error: error?.message, 專案ID });
      return null;
    }
    return rowToEditLog(data as Record<string, unknown>);
  } catch (e) {
    log("master_edit_log", "insert 例外", { error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

export async function listMasterEditLogs(專案ID: string, limit = 80): Promise<MasterEditLogRow[]> {
  const pid = String(專案ID ?? "").trim();
  if (!pid) return [];
  const supabase = getSupabase();
  try {
    const { data, error } = await supabase
      .from("master_edit_log")
      .select("*")
      .eq("專案ID", pid)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return (data as Record<string, unknown>[]).map(rowToEditLog);
  } catch {
    return [];
  }
}

export async function deleteMasterEditLogs(專案ID: string): Promise<void> {
  const pid = String(專案ID ?? "").trim();
  if (!pid) return;
  await getSupabase().from("master_edit_log").delete().eq("專案ID", pid);
}
