/**
 * 系統設定（system_config）
 * 儲存分潤成數、專案類型、角色區塊等，供前端可調整
 */

import { getSupabase } from "@/lib/supabase/server";
import { MASTER_PAYOUT_DEFAULTS } from "@/config/master-payout-defaults";
import { PROJECT_TYPES } from "@/config/project-types";
import { ROLES, ROLE_VISIBILITY, getSectionsForRole as getStaticSectionsForRole } from "@/config/role-visibility";
import type { RoleVisibilityConfig } from "@/config/role-visibility";
import {
  DEFAULT_PAYOUT_DEDUPE_RULES,
  type PayoutDedupeRule,
  type PayoutDedupeRulesByMode,
} from "@/config/payout-dedupe-defaults";
import { DEFAULT_OVERVIEW_KPI_BY_ROLE, OVERVIEW_KPI_KEYS } from "@/config/overview-kpi";
import { DEFAULT_TASK_TYPE_OPTIONS } from "@/config/task-type-defaults";
import { DEFAULT_PROJECT_STATUS_OPTIONS } from "@/config/project-status-defaults";
import { DEFAULT_PROJECT_EXPENSE_TYPE_OPTIONS } from "@/config/project-expense-type-defaults";

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

function mergeOverviewKpiByRole(
  raw: Record<string, string[]> | undefined,
  roles: string[]
): Record<string, string[]> {
  const allowed = new Set<string>(OVERVIEW_KPI_KEYS as unknown as string[]);
  const out: Record<string, string[]> = {};
  for (const role of roles) {
    const fromDb = raw?.[role];
    const fromDefault = DEFAULT_OVERVIEW_KPI_BY_ROLE[role];
    const base = fromDefault?.length ? [...fromDefault] : [...OVERVIEW_KPI_KEYS];
    if (!fromDb?.length) {
      out[role] = base;
      continue;
    }
    const filtered = fromDb.map(String).filter((k) => allowed.has(k));
    out[role] = filtered.length ? filtered : base;
  }
  return out;
}

export async function getSystemConfig(): Promise<{
  master_payout_defaults: PayoutDefaults;
  project_types: ProjectTypes;
  project_status_options: string[];
  project_expense_type_options: string[];
  task_type_options: string[];
  role_visibility: RoleVisibility;
  roles: string[];
  role_permissions: RolePermissions;
  payout_dedupe_rules: PayoutDedupeRulesByMode;
  overview_kpi_by_role: Record<string, string[]>;
}> {
  const { data } = await getSupabase().from("system_config").select("key, value");
  const map = new Map<string, unknown>();
  for (const row of data ?? []) {
    const r = row as { key?: string; value?: unknown };
    if (r.key) map.set(r.key, r.value);
  }

  const payoutRaw = map.get("master_payout_defaults") as Record<string, string> | undefined;
  const projectRaw = map.get("project_types") as string[] | undefined;
  const projectStatusRaw = map.get("project_status_options") as string[] | undefined;
  const projectExpenseTypeRaw = map.get("project_expense_type_options") as string[] | undefined;
  const roleRaw = map.get("role_visibility") as RoleVisibility | undefined;
  const rolesRaw = map.get("roles") as string[] | undefined;
  const permsRaw = map.get("role_permissions") as RolePermissions | undefined;
  const dedupeRaw = map.get("payout_dedupe_rules") as PayoutDedupeRulesByMode | PayoutDedupeRule[] | undefined;
  const overviewKpiRaw = map.get("overview_kpi_by_role") as Record<string, string[]> | undefined;
  const taskTypeRaw = (map.get("task_type_options") ?? map.get("task_status_options")) as string[] | undefined;

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
      ? (() => {
          const d = dedupeRaw as PayoutDedupeRulesByMode;
          return {
            ...DEFAULT_PAYOUT_DEDUPE_RULES,
            mode_a: normalizeDedupe(d.mode_a),
            mode_b: normalizeDedupe(d.mode_b),
            mode_a_merge_same_recipient: Boolean(d.mode_a_merge_same_recipient),
            mode_b_merge_same_recipient: Boolean(d.mode_b_merge_same_recipient),
            mode_a_priority:
              Array.isArray(d.mode_a_priority) && d.mode_a_priority.length > 0
                ? d.mode_a_priority.map(String)
                : [...DEFAULT_PAYOUT_DEDUPE_RULES.mode_a_priority!],
            mode_b_priority:
              Array.isArray(d.mode_b_priority) && d.mode_b_priority.length > 0
                ? d.mode_b_priority.map(String)
                : [...DEFAULT_PAYOUT_DEDUPE_RULES.mode_b_priority!],
          };
        })()
      : Array.isArray(dedupeRaw) && dedupeRaw.length > 0
        ? { ...DEFAULT_PAYOUT_DEDUPE_RULES, mode_a: [], mode_b: normalizeDedupe(dedupeRaw as PayoutDedupeRule[]) }
        : { ...DEFAULT_PAYOUT_DEDUPE_RULES };

  return {
    master_payout_defaults: payoutRaw && Object.keys(payoutRaw).length > 0
      ? { ...MASTER_PAYOUT_DEFAULTS, ...payoutRaw }
      : { ...MASTER_PAYOUT_DEFAULTS },
    project_types: Array.isArray(projectRaw) && projectRaw.length > 0 ? projectRaw : [...PROJECT_TYPES],
    project_status_options:
      Array.isArray(projectStatusRaw) && projectStatusRaw.length > 0
        ? projectStatusRaw.map(String).filter((s) => s.trim().length > 0)
        : [...DEFAULT_PROJECT_STATUS_OPTIONS],
    project_expense_type_options:
      Array.isArray(projectExpenseTypeRaw) && projectExpenseTypeRaw.length > 0
        ? projectExpenseTypeRaw.map(String).filter((s) => s.trim().length > 0)
        : [...DEFAULT_PROJECT_EXPENSE_TYPE_OPTIONS],
    task_type_options:
      Array.isArray(taskTypeRaw) && taskTypeRaw.length > 0
        ? taskTypeRaw.map(String).filter((s) => s.trim().length > 0)
        : [...DEFAULT_TASK_TYPE_OPTIONS],
    role_visibility: roleRaw && Object.keys(roleRaw).length > 0 ? roleRaw : toRoleVisibilityForStorage(ROLE_VISIBILITY),
    roles,
    role_permissions: mergedPerms,
    payout_dedupe_rules: dedupeRules,
    overview_kpi_by_role: mergeOverviewKpiByRole(overviewKpiRaw, roles),
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
  return getStaticSectionsForRole(role);
}

export async function updateSystemConfig(key: string, value: unknown): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("system_config")
    .upsert({ key, value: value ?? {}, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw error;
}
