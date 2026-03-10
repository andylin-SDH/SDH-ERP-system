/**
 * 專案資料層（Supabase）
 * 資料來源：大總表（不再維護獨立專案表）
 * 僅回傳 7 欄：專案ID、專案名稱、專案類型、專案狀態、開案日期、狀態確認日期、備註
 */

import { getSupabase } from "@/lib/supabase/server";
import type { ProjectRow } from "@/modules/projects/types";

function rowToProject(r: Record<string, unknown>): ProjectRow {
  return {
    專案ID: (r.專案ID as string) ?? undefined,
    專案名稱: (r.專案名稱 as string) ?? undefined,
    專案類型: (r.專案類型 as string) ?? undefined,
    專案狀態: (r.專案狀態 as string) ?? undefined,
    開案日期: (r.開案日期 as string) ?? undefined,
    狀態確認日期: (r.狀態確認日期 as string) ?? undefined,
    備註: (r.備註 as string) ?? undefined,
  };
}

export async function getProjects(): Promise<ProjectRow[]> {
  const { data, error } = await getSupabase()
    .from("大總表")
    .select("專案ID, 專案名稱, 專案類型, 專案狀態, 開案日期, 狀態確認日期, 備註")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map((r) => rowToProject(r as Record<string, unknown>));
}
