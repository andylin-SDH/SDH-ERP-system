import type { PartnerRow } from "@/modules/partners/types";
import { PARTNER_STATUS, normalizePartnerStatus } from "@/lib/db/partner-approval";

/** 比對用：去除空白、不分大小寫 */
export function normalizePartnerNameKey(name: string): string {
  return String(name ?? "").trim().replace(/\s+/g, "").toLowerCase();
}

export function normalizePartnerEmailKey(email: string): string {
  return String(email ?? "").trim().toLowerCase();
}

export type PartnerDuplicateMatch = {
  field: "合作夥伴名稱" | "Email";
  existing: PartnerRow;
};

/** 在既有列表中找相同合作夥伴名稱或 Email（新增 KOL 防呆） */
export function findPartnerDuplicateInList(
  list: PartnerRow[],
  input: { 合作夥伴名稱?: string; Email?: string; excludePartnerId?: string }
): PartnerDuplicateMatch | null {
  const nameKey = normalizePartnerNameKey(input.合作夥伴名稱 ?? "");
  const emailKey = normalizePartnerEmailKey(input.Email ?? "");
  const exclude = String(input.excludePartnerId ?? "").trim();
  for (const p of list) {
    const pid = String(p.PartnerID ?? "").trim();
    if (exclude && pid === exclude) continue;
    if (nameKey) {
      const existingName = normalizePartnerNameKey(String(p.合作夥伴名稱 ?? ""));
      if (existingName && existingName === nameKey) {
        return { field: "合作夥伴名稱", existing: p };
      }
    }
    if (emailKey) {
      const existingEmail = normalizePartnerEmailKey(String(p.Email ?? ""));
      if (existingEmail && existingEmail === emailKey) {
        return { field: "Email", existing: p };
      }
    }
  }
  return null;
}

export function formatPartnerDuplicateError(match: PartnerDuplicateMatch): string {
  const id = String(match.existing.PartnerID ?? "—").trim() || "—";
  const name = String(match.existing.合作夥伴名稱 ?? "—").trim() || "—";
  const st = normalizePartnerStatus(match.existing.審核狀態);
  const statusHint =
    st === PARTNER_STATUS.PENDING
      ? "（待審核）"
      : st === PARTNER_STATUS.REJECTED
        ? "（已駁回）"
        : "";
  if (match.field === "Email") {
    return `已有相同 Email 的 KOL：${id} ${name}${statusHint}，請勿重複新增`;
  }
  return `已有相同合作夥伴名稱的 KOL：${id} ${name}${statusHint}，請勿重複新增`;
}
