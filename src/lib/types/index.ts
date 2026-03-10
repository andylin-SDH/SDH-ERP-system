/**
 * 共用型別
 * 角色：董事長、管理者、經紀人、製作人、會計、行政
 */

export type Role = "董事長" | "管理者" | "經紀人" | "製作人" | "會計" | "行政" | string;
export type Scope = string; // 例：主管 | * | all 見全部；KOL_ID 逗號分隔為負責範圍

export interface User {
  email: string;
  name: string;
  role: Role;
  dept: string;
  scope?: Scope;
  activeFlag?: boolean;
}
