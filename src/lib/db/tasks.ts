/**
 * 任務資料層（Supabase）
 * 資料來源：表「任務」
 */

import { getSupabase } from "@/lib/supabase/server";
import type { TaskRow } from "@/modules/tasks/types";

function rowToTask(r: Record<string, unknown>): TaskRow {
  return {
    任務ID: r.任務ID as string,
    專案ID: r.專案ID as string,
    專案名稱: (r.專案名稱 as string) ?? undefined,
    任務: (r.任務名稱 as string) ?? undefined,
    任務類型: ((r.任務類型 ?? r.任務狀態) as string) ?? undefined,
    任務負責人: (r.負責人 as string) ?? undefined,
    任務完成: Boolean(r.任務完成),
  };
}

export async function getTasks(): Promise<TaskRow[]> {
  const { data, error } = await getSupabase()
    .from("任務")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map((r) => rowToTask(r as Record<string, unknown>));
}

export type NewTaskInput = {
  專案ID: string;
  專案名稱?: string | null;
  任務名稱: string;
  任務類型?: string | null;
  負責人?: string | null;
};

export async function createTask(payload: NewTaskInput): Promise<TaskRow> {
  const 專案ID = String(payload.專案ID ?? "").trim();
  if (!專案ID) throw new Error("專案ID 為必填");

  const insertData: Record<string, unknown> = {
    專案ID,
    專案名稱: payload.專案名稱?.trim() ?? null,
    任務名稱: payload.任務名稱?.trim() ?? null,
    任務類型: payload.任務類型?.trim() ?? null,
    負責人: payload.負責人?.trim() ?? null,
  };

  const { data, error } = await getSupabase()
    .from("任務")
    .insert(insertData)
    .select("*")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("新增任務失敗，未取得資料");
  return rowToTask(data as Record<string, unknown>);
}

export type UpdateTaskInput = {
  任務ID: string;
  任務名稱?: string | null;
  任務類型?: string | null;
  負責人?: string | null;
  任務完成?: boolean;
};

export async function updateTask(payload: UpdateTaskInput): Promise<TaskRow> {
  const 任務ID = String(payload.任務ID ?? "").trim();
  if (!任務ID) throw new Error("任務ID 為必填");

  const updateData: Record<string, unknown> = {};
  if (payload.任務名稱 !== undefined) updateData.任務名稱 = payload.任務名稱?.trim() ?? null;
  if (payload.任務類型 !== undefined) updateData.任務類型 = payload.任務類型?.trim() ?? null;
  if (payload.負責人 !== undefined) updateData.負責人 = payload.負責人?.trim() ?? null;
  if (payload.任務完成 !== undefined) updateData.任務完成 = Boolean(payload.任務完成);

  const { data, error } = await getSupabase()
    .from("任務")
    .update(updateData)
    .eq("任務ID", 任務ID)
    .select("*")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("更新任務失敗，未取得資料");
  return rowToTask(data as Record<string, unknown>);
}
