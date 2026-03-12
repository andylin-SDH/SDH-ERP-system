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

/**
 * partners 表實際欄位為「經紀人」；舊 migration 曾寫入「負責經紀人」，讀到該 key 時列上永遠是空 → 整表被濾光
 * 統一對應成「經紀人」再篩選／再寫回 DB
 */
const PARTNERS_MATCH_FIELD_ALIASES: Record<string, string> = {
  負責經紀人: "經紀人",
};

function applyPartnersMatchFieldAliases(fields: string[]): string[] {
  const mapped = fields.map((f) => PARTNERS_MATCH_FIELD_ALIASES[f] ?? f);
  return [...new Set(mapped)];
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
      let arr = normalizeMatchFields(Array.isArray(fields) ? fields : []);
      if (key === "partners") arr = applyPartnersMatchFieldAliases(arr);
      result[key] = arr;
    }
  }
  return result;
}

export async function updateVisibilityRules(rules: Record<string, string[]>): Promise<Record<string, string[]>> {
  const supabase = getSupabase();
  for (const [tableKey, matchFields] of Object.entries(rules)) {
    let cleaned = normalizeMatchFields(matchFields ?? []);
    if (tableKey === "partners") cleaned = applyPartnersMatchFieldAliases(cleaned);
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
