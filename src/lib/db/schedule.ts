import { getSupabase } from "@/lib/supabase/server";
import type { ScheduleClaim } from "@/lib/schedule/types";

const TABLE = "班表";

export class ScheduleTableMissingError extends Error {
  constructor() {
    super("請先在資料庫建立「班表」（migration 070）");
  }
}

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || /班表/.test(error.message ?? "") && /does not exist|schema cache/i.test(error.message ?? "");
}

export async function listClaimsBetween(start: string, endExclusive: string): Promise<ScheduleClaim[]> {
  const { data, error } = await getSupabase()
    .from(TABLE)
    .select('"日期", "整點", "地點", "人員"')
    .gte("日期", start)
    .lt("日期", endExclusive);
  if (error) {
    if (isMissingTable(error)) throw new ScheduleTableMissingError();
    throw new Error(error.message);
  }
  return (data ?? []).map((row) => ({
    date: String(row.日期),
    slot: String(row.整點),
    place: String(row.地點),
    person: String(row.人員),
  }));
}

/** 只新增這次選上的格子，只刪這次取消的格子。 */
export async function applyClaimRows(add: ScheduleClaim[], remove: ScheduleClaim[]): Promise<void> {
  const supabase = getSupabase();
  for (const claim of remove) {
    const { error } = await supabase
      .from(TABLE)
      .delete()
      .eq("日期", claim.date)
      .eq("整點", claim.slot)
      .eq("地點", claim.place)
      .eq("人員", claim.person);
    if (error) {
      if (isMissingTable(error)) throw new ScheduleTableMissingError();
      throw new Error(error.message);
    }
  }
  if (!add.length) return;
  const { error } = await supabase.from(TABLE).upsert(
    add.map((claim) => ({
      日期: claim.date,
      整點: claim.slot,
      地點: claim.place,
      人員: claim.person,
      更新時間: new Date().toISOString(),
    })),
    { onConflict: "日期,整點,地點,人員", ignoreDuplicates: true }
  );
  if (error) {
    if (isMissingTable(error)) throw new ScheduleTableMissingError();
    throw new Error(error.message);
  }
}
