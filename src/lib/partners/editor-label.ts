/** 合作夥伴操作紀錄用：優先顯示姓名，否則 email */
export function partnerEditorLabel(user: { name?: string | null; email?: string | null }): string {
  return String(user.name ?? "").trim() || String(user.email ?? "").trim();
}
