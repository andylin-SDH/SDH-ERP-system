/**
 * 資料可見規則（visibility_rules）
 * 各 Table 的「符合即顯示」欄位，供非 fullAccess 使用者過濾資料
 */

import { getSupabase } from "@/lib/supabase/server";
import { log } from "@/lib/log";
import { VISIBILITY_RULES_DEFAULTS } from "@/config/visibility-rules-defaults";

/** 去掉空字串／空白，避免 DB 存了 [""] 時前端仍以為有 match 而整表被濾光 */
function normalizeMatchFields(fields: string[] | null | undefined): string[] {
  if (!Array.isArray(fields)) return [];
  return fields.map((f) => String(f).trim()).filter(Boolean);
}

/** 大總表：舊規則僅「專案引薦人」時，補上「專案開發人」（模式 B 獨立欄位後仍應能對到廣告業配列） */
function mergeMasterMatchFields(fields: string[]): string[] {
  if (!fields.length) return fields;
  if (fields.includes("專案引薦人") && !fields.includes("專案開發人")) {
    const i = fields.indexOf("專案引薦人");
    return [...fields.slice(0, i + 1), "專案開發人", ...fields.slice(i + 1)];
  }
  return fields;
}

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
    const fields = (row as { match_fields?: string[] | null }).match_fields;
    // 有 table_key 就覆寫：空規則務必為 []，否則 null 會讓 result 仍留預設而繼續過濾
    if (key) {
      let next = normalizeMatchFields(Array.isArray(fields) ? fields : []);
      if (key === "master") next = mergeMasterMatchFields(next);
      result[key] = next;
    }
  }
  return result;
}

export async function updateVisibilityRules(rules: Record<string, string[]>): Promise<Record<string, string[]>> {
  const supabase = getSupabase();
  for (const [tableKey, matchFields] of Object.entries(rules)) {
    const cleaned = normalizeMatchFields(matchFields ?? []);
    const { error } = await supabase
      .from("visibility_rules")
      .upsert({ table_key: tableKey, match_fields: cleaned, updated_at: new Date().toISOString() }, { onConflict: "table_key" });
    if (error) {
      log("visibility-rules.db", "updateVisibilityRules 失敗", { tableKey, error: String(error?.message) });
      throw error;
    }
  }
  log("visibility-rules.db", "updateVisibilityRules 成功");
  return await getVisibilityRules();
}
