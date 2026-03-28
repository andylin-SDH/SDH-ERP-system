/**
 * 使用者可見範圍（user_visibility）
 * 董事長可為每位使用者設定可見的 Table 與欄位
 */

import { getSupabase } from "@/lib/supabase/server";
import { log } from "@/lib/log";

export interface UserVisibilityRow {
  id: string;
  user_email: string;
  tables: string[];
  columns: Record<string, string[]>;
  /** null = 依①角色「總覽指標」設定 */
  overview_kpis: string[] | null;
  created_at?: string;
  updated_at?: string;
}

function rowToVisibility(r: Record<string, unknown>): UserVisibilityRow {
  const cols = r.columns as Record<string, string[]> | null;
  const ok = r.overview_kpis;
  return {
    id: String(r.id ?? ""),
    user_email: String(r.user_email ?? ""),
    tables: Array.isArray(r.tables) ? r.tables : [],
    columns: cols && typeof cols === "object" ? cols : {},
    overview_kpis: Array.isArray(ok) ? ok.map(String) : null,
    created_at: r.created_at as string | undefined,
    updated_at: r.updated_at as string | undefined,
  };
}

export async function getUserVisibility(userEmail: string): Promise<UserVisibilityRow | null> {
  const email = String(userEmail ?? "").trim().toLowerCase();
  if (!email) return null;

  const { data, error } = await getSupabase()
    .from("user_visibility")
    .select("*")
    .eq("user_email", email)
    .maybeSingle();

  if (error) {
    log("user-visibility.db", "getUserVisibility 查詢錯誤", { error: String(error?.message) });
    throw error;
  }
  if (!data) return null;
  return rowToVisibility(data as Record<string, unknown>);
}

export interface UpsertUserVisibilityInput {
  user_email: string;
  tables: string[];
  columns: Record<string, string[]>;
  /** 傳 null 表示清除覆寫、改依①角色預設 */
  overview_kpis?: string[] | null;
}

export async function upsertUserVisibility(payload: UpsertUserVisibilityInput): Promise<UserVisibilityRow> {
  const email = String(payload.user_email ?? "").trim().toLowerCase();
  if (!email) throw new Error("user_email 為必填");

  const upsertRow: Record<string, unknown> = {
    user_email: email,
    tables: payload.tables ?? [],
    columns: payload.columns ?? {},
    updated_at: new Date().toISOString(),
  };
  if (payload.overview_kpis !== undefined) {
    upsertRow.overview_kpis = payload.overview_kpis;
  }

  const { data, error } = await getSupabase()
    .from("user_visibility")
    .upsert(upsertRow, { onConflict: "user_email" })
    .select("*")
    .maybeSingle();

  if (error) {
    log("user-visibility.db", "upsertUserVisibility 失敗", { error: String(error?.message) });
    throw error;
  }
  if (!data) throw new Error("儲存可見範圍失敗");
  log("user-visibility.db", "upsertUserVisibility 成功", { user_email: email });
  return rowToVisibility(data as Record<string, unknown>);
}
