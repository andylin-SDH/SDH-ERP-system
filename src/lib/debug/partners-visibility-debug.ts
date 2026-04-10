/**
 * 合作夥伴可見性除錯：與 Dashboard filterRowsByVisibility(partners) 同邏輯，回傳可觀測數字與原因
 */

import { getSupabase } from "@/lib/supabase/server";
import { getVisibilityRules } from "@/lib/db/visibility-rules";
import { getPartnersWithError } from "@/lib/db/partners";
import { isFullAccessRole } from "@/config/role-visibility";
import type { User } from "@/lib/types";
import type { PartnerRow } from "@/modules/partners";

function normalizeMatchFields(fields: string[] | null | undefined): string[] {
  if (!Array.isArray(fields)) return [];
  return fields.map((f) => String(f).trim()).filter(Boolean);
}

/** 與 dashboard page filterRowsByVisibility 對 partners 一致 */
export function filterPartnersRowsByVisibility(
  rows: PartnerRow[],
  matchFields: string[],
  me: User
): { filtered: PartnerRow[]; reason: string } {
  if (isFullAccessRole(me.role)) {
    return { filtered: rows, reason: "fullAccess_role_no_filter" };
  }
  const fields = normalizeMatchFields(matchFields);
  if (fields.length === 0) {
    return { filtered: rows, reason: "match_fields_empty_show_all" };
  }
  const uName = (me.name ?? "").trim();
  const uEmail = (me.email ?? "").trim();
  const filtered = rows.filter((row) => {
    const r = row as unknown as Record<string, unknown>;
    for (const key of fields) {
      const val = String(r[key] ?? "").trim();
      if (!val) continue;
      if (val === uName || val === uEmail) return true;
    }
    return false;
  });
  return {
    filtered,
    reason:
      filtered.length > 0
        ? "match_fields_applied_has_rows"
        : "match_fields_applied_zero_rows_no_column_equals_name_or_email",
  };
}

export interface PartnersVisibilityDebugPayload {
  ok: true;
  user: { email: string; name: string; role: string };
  /** DB visibility_rules 該列原始 match_fields（未正規化） */
  dbPartnersRow: { table_key: string; match_fields: unknown } | null;
  /** getVisibilityRules() 合併後 partners（已正規化） */
  rulesPartnersMatchFields: string[];
  partnersTotal: number;
  partnersFilteredCount: number;
  filterReason: string;
  partnersError: string | null;
  usedFallback?: boolean;
  /** 前 3 筆每列在 match_fields 上的值，方便對照 */
  sampleRowsMatchValues: Array<Record<string, string>>;
}

export async function buildPartnersVisibilityDebug(user: User): Promise<PartnersVisibilityDebugPayload> {
  const supabase = getSupabase();
  const { data: rawRow } = await supabase
    .from("visibility_rules")
    .select("table_key, match_fields")
    .eq("table_key", "partners")
    .maybeSingle();

  const rules = await getVisibilityRules();
  const matchFields = rules.partners ?? [];

  const { partners, error: partnersError, usedFallback } = await getPartnersWithError();
  const { filtered, reason } = filterPartnersRowsByVisibility(partners, matchFields, user);

  const fieldsForSample = normalizeMatchFields(matchFields);
  const sampleKeys = fieldsForSample.length > 0 ? fieldsForSample : ["合作夥伴名稱"];
  const sampleRowsMatchValues = partners.slice(0, 3).map((row) => {
    const r = row as unknown as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const k of sampleKeys) {
      out[k] = String(r[k] ?? "").trim();
    }
    return out;
  });

  return {
    ok: true,
    user: { email: user.email, name: user.name, role: user.role },
    dbPartnersRow: rawRow
      ? { table_key: String((rawRow as { table_key?: string }).table_key), match_fields: (rawRow as { match_fields?: unknown }).match_fields }
      : null,
    rulesPartnersMatchFields: matchFields,
    partnersTotal: partners.length,
    partnersFilteredCount: filtered.length,
    filterReason: reason,
    partnersError,
    usedFallback,
    sampleRowsMatchValues,
  };
}
