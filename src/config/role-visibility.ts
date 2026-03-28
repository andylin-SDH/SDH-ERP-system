/**
 * 依角色決定「每個帳號該顯示什麼」
 * 對應 docs/DATA_MODEL.md 的關聯性，方便從大總表／分潤表統一設定
 *
 * 角色列表：董事長、管理者、經紀人、製作人、會計、行政
 */

export const ROLES = ["董事長", "管理者", "經紀人", "製作人", "會計", "行政"] as const;
export type RoleKey = (typeof ROLES)[number] | string;

/** 各角色可看到的「區塊」與資料範圍 */
export interface RoleVisibilityConfig {
  /** 是否看全公司資料（不過濾） */
  fullAccess?: boolean;
  /** 可看到的區塊 ID（對應 Dashboard 區塊：partners, tasks, finance...） */
  sections: string[];
  /** 過濾說明（給開發／維運對照用） */
  filterNote?: string;
}

/**
 * 角色 → 可見區塊與過濾方式
 * 新增角色或要改顯示範圍時，改這裡即可
 */
export const ROLE_VISIBILITY: Record<string, RoleVisibilityConfig> = {
  董事長: {
    fullAccess: true,
    sections: ["overview", "master", "partners", "tasks", "payout", "finance", "invoices"],
    filterNote: "全公司，不過濾",
  },
  管理者: {
    fullAccess: true,
    sections: ["overview", "master", "partners", "tasks", "payout", "finance", "invoices"],
    filterNote: "全公司，不過濾",
  },
  經紀人: {
    fullAccess: false,
    sections: ["overview", "partners", "tasks"],
    filterNote: "依 scope／email／姓名過濾；scope=主管/*/all 見全部",
  },
  製作人: {
    fullAccess: false,
    sections: ["overview", "master", "tasks"],
    filterNote: "專案與任務，可依 project_bd 或 task_owner 擴充過濾",
  },
  會計: {
    fullAccess: true,
    sections: ["overview", "payout", "finance", "invoices"],
    filterNote: "財務相關表，目前全開",
  },
  行政: {
    fullAccess: false,
    sections: ["overview", "partners", "tasks"],
    filterNote: "合作夥伴與任務",
  },
};

/** scope 為「主管」或「全部」時，在經紀人範圍內看全部資料（不依人過濾） */
export function isScopeFullAccess(scope: string | undefined): boolean {
  if (!scope || !String(scope).trim()) return false;
  const s = String(scope).trim().toLowerCase();
  return s === "主管" || s === "*" || s === "all";
}

/** 預設：未列出的角色只給基本區塊 */
const DEFAULT_VISIBILITY: RoleVisibilityConfig = {
  fullAccess: false,
  sections: ["overview", "tasks"],
  filterNote: "預設總覽與任務",
};

/**
 * 取得某角色可看到的區塊列表
 */
export function getSectionsForRole(role: string): string[] {
  const config = ROLE_VISIBILITY[role] ?? DEFAULT_VISIBILITY;
  return config.sections;
}

/**
 * 某角色是否為全公司權限（不過濾）
 */
export function isFullAccessRole(role: string): boolean {
  const config = ROLE_VISIBILITY[role] ?? DEFAULT_VISIBILITY;
  return config.fullAccess === true;
}

