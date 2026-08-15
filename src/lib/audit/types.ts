/**
 * 稽核紀錄型別（可給 client／server 共用，勿引入 Supabase）
 */

export type AuditEntityType = "partners" | "master";

export interface AuditLogItem {
  id: string;
  entity_type: AuditEntityType;
  entity_id: string;
  entity_label: string;
  action: string;
  actor: string;
  changed_fields: Record<string, unknown>;
  before_snapshot?: Record<string, unknown>;
  created_at: string;
}

export function auditFieldSummary(item: Pick<AuditLogItem, "changed_fields">): string {
  const keys = Object.keys(item.changed_fields ?? {});
  if (keys.length === 0) return "—";
  if (keys.length <= 4) return keys.join("、");
  return `${keys.slice(0, 4).join("、")} 等 ${keys.length} 欄`;
}
