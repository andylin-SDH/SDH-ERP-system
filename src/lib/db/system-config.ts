/**
 * 系統設定（system_config）
 * 儲存分潤成數、專案類型、角色區塊等，供前端可調整
 */

import { getSupabase } from "@/lib/supabase/server";
import { MASTER_PAYOUT_DEFAULTS } from "@/config/master-payout-defaults";
import { PROJECT_TYPES } from "@/config/project-types";
import { ROLES, ROLE_VISIBILITY } from "@/config/role-visibility";
import type { RoleVisibilityConfig } from "@/config/role-visibility";

export type PayoutDefaults = Record<string, string>;
export type ProjectTypes = string[];
export type RoleVisibility = Record<string, { sections: string[]; fullAccess?: boolean }>;

export async function getSystemConfig(): Promise<{
  master_payout_defaults: PayoutDefaults;
  project_types: ProjectTypes;
  role_visibility: RoleVisibility;
  roles: string[];
}> {
  const { data } = await getSupabase().from("system_config").select("key, value");
  const map = new Map<string, unknown>();
  for (const row of data ?? []) {
    const r = row as { key?: string; value?: unknown };
    if (r.key) map.set(r.key, r.value);
  }

  const payoutRaw = map.get("master_payout_defaults") as Record<string, string> | undefined;
  const projectRaw = map.get("project_types") as string[] | undefined;
  const roleRaw = map.get("role_visibility") as RoleVisibility | undefined;
  const rolesRaw = map.get("roles") as string[] | undefined;

  const roles = Array.isArray(rolesRaw) && rolesRaw.length > 0 ? rolesRaw : [...ROLES];

  return {
    master_payout_defaults: payoutRaw && Object.keys(payoutRaw).length > 0
      ? { ...MASTER_PAYOUT_DEFAULTS, ...payoutRaw }
      : { ...MASTER_PAYOUT_DEFAULTS },
    project_types: Array.isArray(projectRaw) && projectRaw.length > 0 ? projectRaw : [...PROJECT_TYPES],
    role_visibility: roleRaw && Object.keys(roleRaw).length > 0 ? roleRaw : toRoleVisibilityForStorage(ROLE_VISIBILITY),
    roles,
  };
}

function toRoleVisibilityForStorage(rv: Record<string, RoleVisibilityConfig>): RoleVisibility {
  const out: RoleVisibility = {};
  for (const [role, cfg] of Object.entries(rv)) {
    out[role] = { sections: cfg.sections, fullAccess: cfg.fullAccess };
  }
  return out;
}

export async function getSectionsForRole(role: string): Promise<string[]> {
  const { role_visibility } = await getSystemConfig();
  const cfg = role_visibility[role];
  if (cfg?.sections?.length) return cfg.sections;
  return ["tasks"];
}

export async function updateSystemConfig(key: string, value: unknown): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("system_config")
    .upsert({ key, value: value ?? {}, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw error;
}
