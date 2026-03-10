/**
 * 使用者模組型別
 * 對應大總表 Users 工作表
 */

export interface UserRow {
  Email: string;
  Name: string;
  Role: string;
  Dept: string;
  Scope?: string;
  ActiveFlag?: string;
}
