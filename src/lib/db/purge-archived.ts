/**
 * 封存滿 N 天後永久清除主檔（編輯／異動紀錄不刪）
 */

import { getSupabase } from "@/lib/supabase/server";
import { log } from "@/lib/log";
import { insertMasterEditLog, MASTER_EDIT_ACTION } from "@/lib/db/master-edit-log";
import { insertPartnerEditLog, PARTNER_EDIT_ACTION } from "@/lib/db/partner-edit-log";
import { deleteTasksBy專案ID } from "@/lib/db/tasks";
import { deleteFinanceBy專案ID } from "@/lib/db/finance";

function retentionDays(): number {
  const n = Number(process.env.ARCHIVE_RETENTION_DAYS ?? 30);
  if (!Number.isFinite(n) || n < 1) return 30;
  return Math.min(Math.floor(n), 3650);
}

function cutoffIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function missingSoftCol(msg: string): boolean {
  return /deleted_at|schema cache|column/i.test(msg);
}

async function deleteEqIgnoreMissing(table: string, column: string, value: string): Promise<void> {
  const { error } = await getSupabase().from(table).delete().eq(column, value);
  if (!error) return;
  if (error.code === "42P01" || error.code === "PGRST205") return;
  throw error;
}

async function purgePartner(PartnerID: string): Promise<void> {
  await insertPartnerEditLog({
    PartnerID,
    操作: PARTNER_EDIT_ACTION.PURGE,
    更新者: "系統排程",
    變更內容: { purged: true },
  });
  const { error } = await getSupabase().from("partners").delete().eq("PartnerID", PartnerID);
  if (error) throw error;
}

async function purgeMasterRow(id: string, 專案ID: string): Promise<void> {
  await insertMasterEditLog({
    專案ID,
    操作: MASTER_EDIT_ACTION.PURGE,
    更新者: "系統排程",
    變更內容: { purged: true, id },
  });
  await deleteTasksBy專案ID(專案ID);
  await deleteEqIgnoreMissing("分潤表", "專案ID", 專案ID);
  await deleteFinanceBy專案ID(專案ID);
  await deleteEqIgnoreMissing("發票", "專案ID", 專案ID);
  await deleteEqIgnoreMissing("KOL發票", "專案ID", 專案ID);
  await deleteEqIgnoreMissing("長期案任務模板", "專案ID", 專案ID);
  const { error } = await getSupabase().from("大總表").delete().eq("id", id);
  if (error) throw error;
}

export async function purgeExpiredArchives(): Promise<{
  retentionDays: number;
  cutoff: string;
  partners: number;
  master: number;
  errors: string[];
  skipped?: string;
}> {
  const days = retentionDays();
  const cutoff = cutoffIso(days);
  const errors: string[] = [];
  let partners = 0;
  let master = 0;

  const supabase = getSupabase();

  const partnerRes = await supabase
    .from("partners")
    .select("PartnerID, deleted_at")
    .not("deleted_at", "is", null)
    .lt("deleted_at", cutoff);

  if (partnerRes.error) {
    const msg = partnerRes.error.message ?? "";
    if (missingSoftCol(msg)) {
      return { retentionDays: days, cutoff, partners: 0, master: 0, errors, skipped: "soft-delete 欄位尚未建立" };
    }
    throw partnerRes.error;
  }

  for (const row of partnerRes.data ?? []) {
    const pid = String((row as { PartnerID?: string }).PartnerID ?? "").trim();
    if (!pid) continue;
    try {
      await purgePartner(pid);
      partners++;
    } catch (e) {
      errors.push(`partners ${pid}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const masterRes = await supabase
    .from("大總表")
    .select("id, 專案ID, deleted_at")
    .not("deleted_at", "is", null)
    .lt("deleted_at", cutoff);

  if (masterRes.error) {
    const msg = masterRes.error.message ?? "";
    if (missingSoftCol(msg)) {
      return { retentionDays: days, cutoff, partners, master: 0, errors, skipped: "soft-delete 欄位尚未建立" };
    }
    throw masterRes.error;
  }

  for (const row of masterRes.data ?? []) {
    const id = String((row as { id?: string }).id ?? "").trim();
    const 專案ID = String((row as { 專案ID?: string }).專案ID ?? "").trim();
    if (!id || !專案ID) continue;
    try {
      await purgeMasterRow(id, 專案ID);
      master++;
    } catch (e) {
      errors.push(`master ${專案ID}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  log("archive.purge", "purgeExpiredArchives 完成", { days, cutoff, partners, master, errors: errors.length });
  return { retentionDays: days, cutoff, partners, master, errors: errors.slice(0, 40) };
}
