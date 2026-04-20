/**
 * 任務資料層（Supabase）
 * 資料來源：表「任務」
 */

import { getSupabase } from "@/lib/supabase/server";
import type { TaskRow } from "@/modules/tasks/types";

function rowToTask(r: Record<string, unknown>): TaskRow {
  const 開始 = r.開始時間;
  const 完成 = r.完成時間;
  const 到期 = r.到期日;
  let 到期日Str: string | undefined;
  if (到期 != null && String(到期).trim() !== "") {
    const s = String(到期);
    到期日Str = /^(\d{4}-\d{2}-\d{2})/.exec(s)?.[1] ?? s.slice(0, 10);
  }
  return {
    任務ID: r.任務ID as string,
    專案ID: r.專案ID as string,
    專案名稱: (r.專案名稱 as string) ?? undefined,
    任務: (r.任務名稱 as string) ?? undefined,
    任務類型: ((r.任務類型 ?? r.任務狀態) as string) ?? undefined,
    任務負責人: (r.負責人 as string) ?? undefined,
    開始時間: 開始 != null && String(開始).trim() !== "" ? String(開始) : undefined,
    完成時間: 完成 != null && String(完成).trim() !== "" ? String(完成) : undefined,
    任務完成: Boolean(r.任務完成),
    到期日: 到期日Str,
    備註: (r.備註 as string) ?? undefined,
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
  備註?: string | null;
  /** YYYY-MM-DD */
  到期日?: string | null;
};

export async function createTask(payload: NewTaskInput): Promise<TaskRow> {
  const 專案ID = String(payload.專案ID ?? "").trim();
  if (!專案ID) throw new Error("專案ID 為必填");

  const nowIso = new Date().toISOString();
  const insertData: Record<string, unknown> = {
    專案ID,
    專案名稱: payload.專案名稱?.trim() ?? null,
    任務名稱: payload.任務名稱?.trim() ?? null,
    任務類型: payload.任務類型?.trim() ?? null,
    負責人: payload.負責人?.trim() ?? null,
    開始時間: nowIso,
  };
  if (payload.備註 !== undefined) {
    const n = payload.備註?.trim() ?? "";
    insertData.備註 = n === "" ? null : n;
  }
  if (payload.到期日 !== undefined && payload.到期日 !== null && String(payload.到期日).trim() !== "") {
    const d = String(payload.到期日).trim().slice(0, 10);
    insertData.到期日 = /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
  } else if (payload.到期日 === null) {
    insertData.到期日 = null;
  }

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
  備註?: string | null;
  任務完成?: boolean;
  /** YYYY-MM-DD；傳 null 可清空 */
  到期日?: string | null;
};

/** 刪除該專案底下所有任務（與大總表刪除連動） */
export async function deleteTasksBy專案ID(專案ID: string): Promise<void> {
  const pid = String(專案ID ?? "").trim();
  if (!pid) return;
  const { error } = await getSupabase().from("任務").delete().eq("專案ID", pid);
  if (error) {
    if (error.code === "42P01") return;
    throw error;
  }
}

export async function updateTask(payload: UpdateTaskInput): Promise<TaskRow> {
  const 任務ID = String(payload.任務ID ?? "").trim();
  if (!任務ID) throw new Error("任務ID 為必填");

  const { data: existing, error: fetchErr } = await getSupabase()
    .from("任務")
    .select("*")
    .eq("任務ID", 任務ID)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!existing) throw new Error("找不到任務");

  const prev負責人 = String((existing as Record<string, unknown>).負責人 ?? "").trim();
  const prev到期 = (existing as Record<string, unknown>).到期日;
  const prev到期Str = prev到期 != null && String(prev到期).trim() !== "" ? String(prev到期).slice(0, 10) : "";

  const updateData: Record<string, unknown> = {};
  if (payload.任務名稱 !== undefined) updateData.任務名稱 = payload.任務名稱?.trim() ?? null;
  if (payload.任務類型 !== undefined) updateData.任務類型 = payload.任務類型?.trim() ?? null;
  if (payload.負責人 !== undefined) {
    const next = payload.負責人?.trim() ?? null;
    updateData.負責人 = next;
    if (next !== prev負責人) updateData.到期提醒寄送於 = null;
  }
  if (payload.備註 !== undefined) {
    const n = payload.備註?.trim() ?? "";
    updateData.備註 = n === "" ? null : n;
  }
  if (payload.到期日 !== undefined) {
    const raw = payload.到期日;
    const next =
      raw === null || String(raw).trim() === ""
        ? null
        : String(raw).trim().slice(0, 10);
    updateData.到期日 = next && /^\d{4}-\d{2}-\d{2}$/.test(next) ? next : null;
    const nextNorm = updateData.到期日 as string | null;
    const prevNorm = prev到期Str && /^\d{4}-\d{2}-\d{2}$/.test(prev到期Str) ? prev到期Str : "";
    if (String(nextNorm ?? "") !== String(prevNorm)) updateData.到期提醒寄送於 = null;
  }
  if (payload.任務完成 !== undefined) {
    const next = Boolean(payload.任務完成);
    const prev = Boolean((existing as Record<string, unknown>).任務完成);
    updateData.任務完成 = next;
    if (next && !prev) {
      updateData.完成時間 = new Date().toISOString();
    } else if (!next) {
      updateData.完成時間 = null;
    }
  }

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

/** Cron：未完成、已填到期日、尚未寄送提醒者（再以 shouldSendDueReminder 過濾） */
export async function listTasksForDueReminderCron(): Promise<TaskRow[]> {
  const { data, error } = await getSupabase()
    .from("任務")
    .select("*")
    .eq("任務完成", false)
    .not("到期日", "is", null)
    .is("到期提醒寄送於", null);

  if (error) throw error;
  return (data ?? []).map((r) => rowToTask(r as Record<string, unknown>));
}

export async function markTaskDueReminderSent(任務ID: string): Promise<void> {
  const id = String(任務ID ?? "").trim();
  if (!id) return;
  const { error } = await getSupabase()
    .from("任務")
    .update({ 到期提醒寄送於: new Date().toISOString() })
    .eq("任務ID", id);
  if (error) throw error;
}
