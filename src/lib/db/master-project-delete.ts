/**
 * 刪除大總表專案（連動：任務、分潤表、財務）
 * 與 master.ts 分檔，避免與 payout 循環引用。
 */

import { getSupabase } from "@/lib/supabase/server";
import { log } from "@/lib/log";
import { deletePayoutBy專案ID } from "@/lib/db/payout";
import { deleteTasksBy專案ID } from "@/lib/db/tasks";
import { deleteFinanceBy專案ID } from "@/lib/db/finance";

export async function deleteMasterProjectByRowId(rowId: string): Promise<{ 專案ID: string }> {
  const id = String(rowId ?? "").trim();
  if (!id) throw new Error("id 為必填");

  const supabase = getSupabase();
  const { data, error } = await supabase.from("大總表").select("專案ID").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("找不到該專案");
  const 專案ID = String((data as { 專案ID?: string }).專案ID ?? "").trim();
  if (!專案ID) throw new Error("專案ID 無效");

  await deleteTasksBy專案ID(專案ID);
  await deletePayoutBy專案ID(專案ID);
  await deleteFinanceBy專案ID(專案ID);

  const { error: delErr } = await supabase.from("大總表").delete().eq("id", id);
  if (delErr) throw delErr;
  log("master.delete", "deleteMasterProjectByRowId 成功", { id, 專案ID });
  return { 專案ID };
}
