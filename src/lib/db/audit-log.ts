/**
 * 董事長稽核中心：聯集 KOL／大總表編輯紀錄
 */

import { listRecentPartnerEditLogs } from "@/lib/db/partner-edit-log";
import { listRecentMasterEditLogs } from "@/lib/db/master-edit-log";
import type { AuditEntityType, AuditLogItem } from "@/lib/audit/types";

export type { AuditEntityType, AuditLogItem } from "@/lib/audit/types";
export { auditFieldSummary } from "@/lib/audit/types";

export async function listUnifiedAuditLogs(options?: {
  limit?: number;
  entityType?: AuditEntityType | "all";
  action?: string;
  q?: string;
}): Promise<AuditLogItem[]> {
  const limit = Math.min(Math.max(options?.limit ?? 150, 1), 400);
  const perSource = Math.min(limit, 250);
  const entityType = options?.entityType ?? "all";
  const actionFilter = String(options?.action ?? "").trim();
  const q = String(options?.q ?? "").trim().toLowerCase();

  const [partnerLogs, masterLogs] = await Promise.all([
    entityType === "master" ? Promise.resolve([]) : listRecentPartnerEditLogs(perSource),
    entityType === "partners" ? Promise.resolve([]) : listRecentMasterEditLogs(perSource),
  ]);

  const partnerNameById = new Map<string, string>();
  for (const log of partnerLogs) {
    const snap = log.變更前快照 ?? {};
    const name = String(
      (log.變更內容 as Record<string, unknown>)?.["合作夥伴名稱"] ??
        snap["合作夥伴名稱"] ??
        ""
    ).trim();
    if (name && !partnerNameById.has(log.PartnerID)) partnerNameById.set(log.PartnerID, name);
  }

  const masterNameById = new Map<string, string>();
  for (const log of masterLogs) {
    const snap = log.變更前快照 ?? {};
    const name = String(
      (log.變更內容 as Record<string, unknown>)?.["專案名稱"] ?? snap["專案名稱"] ?? ""
    ).trim();
    if (name && !masterNameById.has(log.專案ID)) masterNameById.set(log.專案ID, name);
  }

  let items: AuditLogItem[] = [
    ...partnerLogs.map((log) => ({
      id: `partners:${log.id}`,
      entity_type: "partners" as const,
      entity_id: log.PartnerID,
      entity_label: partnerNameById.get(log.PartnerID) || log.PartnerID,
      action: log.操作,
      actor: log.更新者,
      changed_fields: log.變更內容 ?? {},
      before_snapshot: log.變更前快照,
      created_at: String(log.created_at ?? ""),
    })),
    ...masterLogs.map((log) => ({
      id: `master:${log.id}`,
      entity_type: "master" as const,
      entity_id: log.專案ID,
      entity_label: masterNameById.get(log.專案ID) || log.專案ID,
      action: log.操作,
      actor: log.更新者,
      changed_fields: log.變更內容 ?? {},
      before_snapshot: log.變更前快照,
      created_at: String(log.created_at ?? ""),
    })),
  ];

  if (actionFilter) {
    items = items.filter((i) => i.action === actionFilter);
  }
  if (q) {
    items = items.filter((i) => {
      const blob = `${i.entity_id} ${i.entity_label} ${i.actor} ${i.action}`.toLowerCase();
      return blob.includes(q);
    });
  }

  items.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return items.slice(0, limit);
}
