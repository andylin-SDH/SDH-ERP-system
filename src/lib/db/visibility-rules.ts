/**
 * 資料可見規則（visibility_rules）
 * 各 Table 的「符合即顯示」欄位，供非 fullAccess 使用者過濾資料
 */

import { getSupabase } from "@/lib/supabase/server";
import { log } from "@/lib/log";
import { VISIBILITY_RULES_DEFAULTS } from "@/config/visibility-rules-defaults";

export async function getVisibilityRules(): Promise<Record<string, string[]>> {
  const { data, error } = await getSupabase()
    .from("visibility_rules")
    .select("table_key, match_fields")
    .order("table_key");

  if (error) {
    log("visibility-rules.db", "getVisibilityRules 查詢錯誤", { error: String(error?.message) });
    return { ...VISIBILITY_RULES_DEFAULTS };
  }

  const result: Record<string, string[]> = { ...VISIBILITY_RULES_DEFAULTS };
  for (const row of data ?? []) {
    const key = (row as { table_key?: string }).table_key;
    const fields = (row as { match_fields?: string[] }).match_fields;
    if (key && Array.isArray(fields)) {
      result[key] = fields;
    }
  }
  return result;
}

export async function updateVisibilityRules(rules: Record<string, string[]>): Promise<Record<string, string[]>> {
  const supabase = getSupabase();
  for (const [tableKey, matchFields] of Object.entries(rules)) {
    const { error } = await supabase
      .from("visibility_rules")
      .upsert({ table_key: tableKey, match_fields: matchFields ?? [], updated_at: new Date().toISOString() }, { onConflict: "table_key" });
    if (error) {
      log("visibility-rules.db", "updateVisibilityRules 失敗", { tableKey, error: String(error?.message) });
      throw error;
    }
  }
  log("visibility-rules.db", "updateVisibilityRules 成功");
  return await getVisibilityRules();
}
