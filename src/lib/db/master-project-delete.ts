/**
 * 軟刪大總表專案（不硬刪；不連動清除任務／分潤／財務／edit log）
 */

import { getSupabase } from "@/lib/supabase/server";
import { log } from "@/lib/log";
import { insertMasterEditLog, MASTER_EDIT_ACTION } from "@/lib/db/master-edit-log";
import type { MasterRow } from "@/lib/db/master";

function softDeleteColumnMissing(msg: string): boolean {
  return /deleted_at|schema cache|column/i.test(msg);
}

export async function softDeleteMasterProjectByRowId(
  rowId: string,
  editor: string,
  reason?: string | null
): Promise<{ 專案ID: string; alreadyDeleted?: boolean }> {
  const id = String(rowId ?? "").trim();
  if (!id) throw new Error("id 為必填");

  const supabase = getSupabase();
  const { data, error } = await supabase.from("大總表").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("找不到該專案");

  const row = data as Record<string, unknown>;
  const 專案ID = String(row.專案ID ?? "").trim();
  if (!專案ID) throw new Error("專案ID 無效");

  if (row.deleted_at) {
    return { 專案ID, alreadyDeleted: true };
  }

  const now = new Date().toISOString();
  const { error: updErr } = await supabase
    .from("大總表")
    .update({
      deleted_at: now,
      deleted_by: editor || null,
      delete_reason: reason?.trim() || null,
    })
    .eq("id", id)
    .is("deleted_at", null);

  if (updErr) {
    const msg = updErr.message ?? String(updErr);
    if (softDeleteColumnMissing(msg)) {
      throw new Error("資料庫尚未啟用軟刪欄位，請先執行 migration 066_soft_delete_partners_master.sql");
    }
    throw updErr;
  }

  const snapshot = { ...row };
  delete snapshot.deleted_at;
  delete snapshot.deleted_by;
  delete snapshot.delete_reason;

  await insertMasterEditLog({
    專案ID,
    操作: MASTER_EDIT_ACTION.DELETE,
    更新者: editor || "系統",
    變更內容: { deleted_at: now, ...(reason?.trim() ? { delete_reason: reason.trim() } : {}) },
    變更前快照: snapshot,
  });

  log("master.delete", "softDeleteMasterProjectByRowId 成功", { id, 專案ID });
  return { 專案ID };
}

/** @deprecated 改為軟刪 */
export async function deleteMasterProjectByRowId(rowId: string): Promise<{ 專案ID: string }> {
  return softDeleteMasterProjectByRowId(rowId, "系統");
}

export async function restoreMasterProjectByRowId(
  rowId: string,
  editor: string
): Promise<{ 專案ID: string; row?: MasterRow }> {
  const id = String(rowId ?? "").trim();
  if (!id) throw new Error("id 為必填");

  const supabase = getSupabase();
  const { data, error } = await supabase.from("大總表").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("找不到該專案");

  const row = data as Record<string, unknown>;
  const 專案ID = String(row.專案ID ?? "").trim();
  if (!專案ID) throw new Error("專案ID 無效");

  if (!row.deleted_at) {
    return { 專案ID };
  }

  const { error: updErr } = await supabase
    .from("大總表")
    .update({
      deleted_at: null,
      deleted_by: null,
      delete_reason: null,
    })
    .eq("id", id);

  if (updErr) {
    const msg = updErr.message ?? String(updErr);
    if (softDeleteColumnMissing(msg)) {
      throw new Error("資料庫尚未啟用軟刪欄位，請先執行 migration 066_soft_delete_partners_master.sql");
    }
    throw updErr;
  }

  await insertMasterEditLog({
    專案ID,
    操作: MASTER_EDIT_ACTION.RESTORE,
    更新者: editor || "系統",
    變更內容: { deleted_at: null },
    變更前快照: { deleted_at: row.deleted_at, deleted_by: row.deleted_by },
  });

  log("master.restore", "restoreMasterProjectByRowId 成功", { id, 專案ID });
  return { 專案ID };
}

export async function restoreMasterProjectBy專案ID(
  專案ID: string,
  editor: string
): Promise<{ id: string; 專案ID: string }> {
  const pid = String(專案ID ?? "").trim();
  if (!pid) throw new Error("專案ID 為必填");
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("大總表")
    .select("id, 專案ID, deleted_at")
    .eq("專案ID", pid)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("找不到該專案");
  const id = String((data as { id?: string }).id ?? "").trim();
  await restoreMasterProjectByRowId(id, editor);
  return { id, 專案ID: pid };
}
