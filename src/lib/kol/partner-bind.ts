/**
 * KOL 帳號 ↔ partners ↔ 大總表專案 綁定
 */

import type { User } from "@/lib/types";
import { getMasterList } from "@/lib/db/master";
import { getPartnersApprovedWithError } from "@/lib/db/partners";

export type KolPartnerBinding = {
  partnerId: string;
  partnerName: string;
};

export async function resolveKolPartnerForUser(user: User): Promise<
  | { ok: true; binding: KolPartnerBinding }
  | { ok: false; error: string }
> {
  const { partners, error } = await getPartnersApprovedWithError();
  if (error && !partners.length) {
    return { ok: false, error: error || "無法讀取合作夥伴資料" };
  }

  const fromScope = String(user.scope ?? "").trim();
  if (fromScope) {
    const p = partners.find((x) => String(x.PartnerID ?? "").trim() === fromScope);
    if (!p) {
      return { ok: false, error: `找不到 PartnerID「${fromScope}」的 KOL。` };
    }
    return {
      ok: true,
      binding: {
        partnerId: String(p.PartnerID ?? "").trim(),
        partnerName: String(p.合作夥伴名稱 ?? "").trim(),
      },
    };
  }

  const em = String(user.email ?? "").trim().toLowerCase();
  const p = partners.find((x) => String(x.Email ?? "").trim().toLowerCase() === em);
  if (!p) {
    return {
      ok: false,
      error: "此帳號尚未綁定 KOL，請設定 scope（PartnerID）或 partners Email。",
    };
  }
  return {
    ok: true,
    binding: {
      partnerId: String(p.PartnerID ?? "").trim(),
      partnerName: String(p.合作夥伴名稱 ?? "").trim(),
    },
  };
}

/** 該 KOL 帳號可存取之專案 ID 集合 */
export async function getKolAccessibleProjectIds(user: User): Promise<
  | { ok: true; partnerName: string; projectIds: Set<string> }
  | { ok: false; error: string }
> {
  const resolved = await resolveKolPartnerForUser(user);
  if (!resolved.ok) return resolved;
  const { partnerName } = resolved.binding;
  if (!partnerName) {
    return { ok: false, error: "合作夥伴名稱空白，無法對應專案。" };
  }

  const masters = await getMasterList();
  const projectIds = new Set<string>();
  for (const row of masters) {
    if (String(row.KOL名稱 ?? "").trim() !== partnerName) continue;
    const pid = String(row.專案ID ?? "").trim();
    if (pid) projectIds.add(pid);
  }
  return { ok: true, partnerName, projectIds };
}

export async function kolUserOwnsProject(user: User, 專案ID: string): Promise<boolean> {
  const access = await getKolAccessibleProjectIds(user);
  if (!access.ok) return false;
  return access.projectIds.has(String(專案ID ?? "").trim());
}
