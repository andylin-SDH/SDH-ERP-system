/**
 * 系統設定（system_config）
 * 儲存分潤成數、專案類型、角色區塊等，供前端可調整
 */

import { getSupabase } from "@/lib/supabase/server";
import { MASTER_PAYOUT_DEFAULTS } from "@/config/master-payout-defaults";
import { PROJECT_TYPES } from "@/config/project-types";
import { ROLES, ROLE_VISIBILITY } from "@/config/role-visibility";
import type { RoleVisibilityConfig } from "@/config/role-visibility";
import {
  DEFAULT_PAYOUT_DEDUPE_RULES,
  type PayoutDedupeRule,
  type PayoutDedupeRulesByMode,
} from "@/config/payout-dedupe-defaults";

export type PayoutDefaults = Record<string, string>;
export type ProjectTypes = string[];
export type RoleVisibility = Record<string, { sections: string[]; fullAccess?: boolean }>;

export type { PayoutDedupeRule, PayoutDedupeRulesByMode };

export type RolePermissions = {
  master: {
    create: string[];
    update: string[];
    delete: string[];
  };
};

function getDefaultRolePermissions(roles: string[]): RolePermissions {
  const uniqueRoles = [...new Set(roles)];
  const adminRoles = uniqueRoles.filter((r) => r === "董事長" || r === "管理者");
  return {
    master: {
      create: uniqueRoles,
      update: adminRoles.length ? adminRoles : uniqueRoles,
      delete: adminRoles.length ? adminRoles : uniqueRoles,
    },
  };
}

export { DEFAULT_PAYOUT_DEDUPE_RULES };

export async function getSystemConfig(): Promise<{
  master_payout_defaults: PayoutDefaults;
  project_types: ProjectTypes;
  role_visibility: RoleVisibility;
  roles: string[];
  role_permissions: RolePermissions;
  payout_dedupe_rules: PayoutDedupeRulesByMode;
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
  const permsRaw = map.get("role_permissions") as RolePermissions | undefined;
  const dedupeRaw = map.get("payout_dedupe_rules") as PayoutDedupeRulesByMode | PayoutDedupeRule[] | undefined;

  const roles = Array.isArray(rolesRaw) && rolesRaw.length > 0 ? rolesRaw : [...ROLES];
  const defaultPerms = getDefaultRolePermissions(roles);

  const mergedPerms: RolePermissions = permsRaw && permsRaw.master
    ? {
        master: {
          create: (permsRaw.master.create?.length ? permsRaw.master.create : defaultPerms.master.create).filter((r) => roles.includes(r)),
          update: (permsRaw.master.update?.length ? permsRaw.master.update : defaultPerms.master.update).filter((r) => roles.includes(r)),
          delete: (permsRaw.master.delete?.length ? permsRaw.master.delete : defaultPerms.master.delete).filter((r) => roles.includes(r)),
        },
      }
    : defaultPerms;

  const normalizeDedupe = (v: PayoutDedupeRule[] | undefined): PayoutDedupeRule[] =>
    Array.isArray(v)
      ? v.filter((r) => Array.isArray(r.roles) && r.roles.length >= 2 && r.keep && r.roles.includes(r.keep))
      : [];
  const dedupeRules: PayoutDedupeRulesByMode =
    dedupeRaw && typeof dedupeRaw === "object" && !Array.isArray(dedupeRaw) && "mode_a" in dedupeRaw && "mode_b" in dedupeRaw
      ? {
          mode_a: normalizeDedupe((dedupeRaw as PayoutDedupeRulesByMode).mode_a),
          mode_b: normalizeDedupe((dedupeRaw as PayoutDedupeRulesByMode).mode_b),
        }
      : Array.isArray(dedupeRaw) && dedupeRaw.length > 0
        ? { mode_a: [], mode_b: normalizeDedupe(dedupeRaw as PayoutDedupeRule[]) }
        : { ...DEFAULT_PAYOUT_DEDUPE_RULES };

  return {
    master_payout_defaults: payoutRaw && Object.keys(payoutRaw).length > 0
      ? { ...MASTER_PAYOUT_DEFAULTS, ...payoutRaw }
      : { ...MASTER_PAYOUT_DEFAULTS },
    project_types: Array.isArray(projectRaw) && projectRaw.length > 0 ? projectRaw : [...PROJECT_TYPES],
    role_visibility: roleRaw && Object.keys(roleRaw).length > 0 ? roleRaw : toRoleVisibilityForStorage(ROLE_VISIBILITY),
    roles,
    role_permissions: mergedPerms,
    payout_dedupe_rules: dedupeRules,
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
