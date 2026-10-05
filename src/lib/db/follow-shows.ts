import { getSupabase } from "@/lib/supabase/server";
import type { FollowShow } from "@/lib/schedule/types";

const TABLE = "跟錄名單";

export class FollowTableMissingError extends Error {
  constructor() {
    super("請先在資料庫建立「跟錄名單」（migration 071）");
  }
}

export type FollowShowRecord = FollowShow & { id: number };

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || (/跟錄名單/.test(error.message ?? "") && /does not exist|schema cache/i.test(error.message ?? ""));
}

function splitList(value: string): string[] {
  return String(value ?? "")
    .split(/[,，、]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function rowToShow(row: { id: number; 節目: string; 關鍵字: string; 同行: string; 折扣碼: string }): FollowShowRecord {
  return {
    id: Number(row.id),
    show: String(row.節目 ?? "").trim(),
    keywords: splitList(row.關鍵字),
    usuallyWith: splitList(row.同行),
    codes: splitList(row.折扣碼),
  };
}

export async function listFollowShowRecords(): Promise<FollowShowRecord[]> {
  const { data, error } = await getSupabase()
    .from(TABLE)
    .select('"id", "節目", "關鍵字", "同行", "折扣碼"')
    .order("id", { ascending: true });
  if (error) {
    if (isMissingTable(error)) throw new FollowTableMissingError();
    throw new Error(error.message);
  }
  return (data ?? []).map((row) => rowToShow(row as { id: number; 節目: string; 關鍵字: string; 同行: string; 折扣碼: string }));
}

export async function insertFollowShow(show: string, keywords: string[], companions: string[]): Promise<void> {
  const { error } = await getSupabase().from(TABLE).insert({
    節目: show,
    關鍵字: keywords.join("、"),
    同行: companions.join("、"),
    折扣碼: "",
    更新時間: new Date().toISOString(),
  });
  if (error) {
    if (isMissingTable(error)) throw new FollowTableMissingError();
    if (error.code === "23505") throw new Error("已經有這個節目");
    throw new Error(error.message);
  }
}

/** 只改名稱、關鍵字、同行。折扣碼留在原列，不從網頁覆寫。 */
export async function updateFollowShow(id: number, show: string, keywords: string[], companions: string[]): Promise<void> {
  const { data, error } = await getSupabase()
    .from(TABLE)
    .update({
      節目: show,
      關鍵字: keywords.join("、"),
      同行: companions.join("、"),
      更新時間: new Date().toISOString(),
    })
    .eq("id", id)
    .select("id");
  if (error) {
    if (isMissingTable(error)) throw new FollowTableMissingError();
    if (error.code === "23505") throw new Error("已經有這個節目");
    throw new Error(error.message);
  }
  if (!data?.length) throw new Error("找不到這個節目");
}

export async function deleteFollowShow(id: number): Promise<void> {
  const { data, error } = await getSupabase().from(TABLE).delete().eq("id", id).select("id");
  if (error) {
    if (isMissingTable(error)) throw new FollowTableMissingError();
    throw new Error(error.message);
  }
  if (!data?.length) throw new Error("找不到這個節目");
}
