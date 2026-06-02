/**
 * KOL（老師）專用只讀總覽：依 partners 對應大總表 KOL 名稱，串依專案財務／發票
 */

import type { User } from "@/lib/types";
import type { FinanceRow } from "@/modules/finance";
import type { InvoiceRow } from "@/modules/finance";
import { getMasterList } from "@/lib/db/master";
import { getPartnersApprovedWithError } from "@/lib/db/partners";
import { getFinance, getInvoices } from "@/modules/finance";
import { kolFinanceProgressShort } from "@/lib/kol/finance-status";
import { formatKolAmountInt, parseKolAmount, sumKolInvoiceAmount含稅 } from "@/lib/kol/format";
import type { KolPortalProject } from "@/lib/kol/types";

export type { KolPortalProject } from "@/lib/kol/types";

export async function buildKolPortalData(user: User): Promise<
  | { ok: true; partnerId: string; partnerName: string; projects: KolPortalProject[] }
  | { ok: false; error: string }
> {
  const { partners, error } = await getPartnersApprovedWithError();
  if (error && !partners.length) {
    return { ok: false, error: error || "無法讀取合作夥伴資料" };
  }

  let partnerId: string | null = null;
  let partnerName = "";

  const fromScope = String(user.scope ?? "").trim();
  if (fromScope) {
    const p = partners.find((x) => String(x.PartnerID ?? "").trim() === fromScope);
    if (!p) {
      return { ok: false, error: `找不到 PartnerID「${fromScope}」的 KOL，請確認帳號 scope 是否正確。` };
    }
    partnerId = String(p.PartnerID ?? "").trim();
    partnerName = String(p.合作夥伴名稱 ?? "").trim();
  } else {
    const em = String(user.email ?? "").trim().toLowerCase();
    const p = partners.find((x) => String(x.Email ?? "").trim().toLowerCase() === em);
    if (!p) {
      return {
        ok: false,
        error:
          "此帳號尚未綁定 KOL：請在「使用者」將角色設為 KOL，scope 填 PartnerID（如 KOL-001），或將 partners 的 Email 設為此登入信箱。",
      };
    }
    partnerId = String(p.PartnerID ?? "").trim();
    partnerName = String(p.合作夥伴名稱 ?? "").trim();
  }

  if (!partnerName) {
    return { ok: false, error: "合作夥伴名稱空白，無法對應專案。" };
  }

  const [masterList, financeList, invoiceList] = await Promise.all([getMasterList(), getFinance(), getInvoices()]);

  const financeByPid = new Map<string, FinanceRow>();
  for (const f of financeList) {
    const pid = String(f.專案ID ?? "").trim();
    if (pid) financeByPid.set(pid, f);
  }

  const invoicesByPid = new Map<string, InvoiceRow[]>();
  for (const inv of invoiceList) {
    const pid = String(inv.專案ID ?? "").trim();
    if (!pid) continue;
    if (!invoicesByPid.has(pid)) invoicesByPid.set(pid, []);
    invoicesByPid.get(pid)!.push(inv);
  }

  const projects: KolPortalProject[] = [];
  for (const row of masterList) {
    if (String(row.KOL名稱 ?? "").trim() !== partnerName) continue;
    const pid = String(row.專案ID ?? "").trim();
    if (!pid) continue;
    const f = financeByPid.get(pid);
    const invs = invoicesByPid.get(pid) ?? [];
    projects.push({
      專案ID: pid,
      專案名稱: String(row.專案名稱 ?? "—"),
      專案狀態: String(row.專案狀態 ?? "—").trim() || "—",
      專案總金額未稅: formatKolAmountInt(parseKolAmount(row.專案總金額未稅)),
      KOL費用未稅: formatKolAmountInt(parseKolAmount(row.KOL費用未稅)),
      結帳狀態: kolFinanceProgressShort(f?.廠商付款日期, f?.員工分潤日期),
      廠商付款日期: String(f?.廠商付款日期 ?? "").trim() || "—",
      發票已開含稅合計: sumKolInvoiceAmount含稅(invs),
      發票筆數: invs.length,
    });
  }

  projects.sort((a, b) => a.專案ID.localeCompare(b.專案ID, "zh-Hant"));

  return {
    ok: true,
    partnerId: partnerId!,
    partnerName,
    projects,
  };
}
