/**
 * KOL（老師）專用總覽：依 partners 對應大總表 KOL 名稱，串依專案財務／發票／KOL 請款發票
 */

import type { User } from "@/lib/types";
import type { FinanceRow } from "@/modules/finance";
import type { InvoiceRow } from "@/modules/finance";
import { getMasterList } from "@/lib/db/master";
import { getKolInvoicesByProjectIds } from "@/lib/db/kol-invoices";
import { getFinance, getInvoices } from "@/modules/finance";
import { kolFinanceProgressShort } from "@/lib/kol/finance-status";
import { formatKolAmountInt, parseKolAmount, sumKolInvoiceAmount含稅 } from "@/lib/kol/format";
import { resolveKolPartnerForUser } from "@/lib/kol/partner-bind";
import type { KolPortalProject } from "@/lib/kol/types";

export type { KolPortalProject } from "@/lib/kol/types";

export async function buildKolPortalData(user: User): Promise<
  | { ok: true; partnerId: string; partnerName: string; projects: KolPortalProject[] }
  | { ok: false; error: string }
> {
  const resolved = await resolveKolPartnerForUser(user);
  if (!resolved.ok) return resolved;

  const { partnerId, partnerName } = resolved.binding;
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

  const matchedPids: string[] = [];
  for (const row of masterList) {
    if (String(row.KOL名稱 ?? "").trim() !== partnerName) continue;
    const pid = String(row.專案ID ?? "").trim();
    if (pid) matchedPids.push(pid);
  }

  const kolInvoiceByPid = await getKolInvoicesByProjectIds(matchedPids);

  const projects: KolPortalProject[] = [];
  for (const row of masterList) {
    if (String(row.KOL名稱 ?? "").trim() !== partnerName) continue;
    const pid = String(row.專案ID ?? "").trim();
    if (!pid) continue;
    const f = financeByPid.get(pid);
    const invs = invoicesByPid.get(pid) ?? [];
    const kolInv = kolInvoiceByPid.get(pid);
    const 結帳狀態 = kolFinanceProgressShort(f?.廠商付款日期, f?.員工分潤日期);
    projects.push({
      專案ID: pid,
      專案名稱: String(row.專案名稱 ?? "—"),
      專案狀態: String(row.專案狀態 ?? "—").trim() || "—",
      專案總金額未稅: formatKolAmountInt(parseKolAmount(row.專案總金額未稅)),
      KOL費用未稅: formatKolAmountInt(parseKolAmount(row.KOL費用未稅)),
      結帳狀態,
      廠商付款日期: String(f?.廠商付款日期 ?? "").trim() || "—",
      發票已開含稅合計: sumKolInvoiceAmount含稅(invs),
      發票筆數: invs.length,
      客戶端發票: invs.map((inv) => ({
        發票號碼: String(inv.發票號碼 ?? "").trim() || "—",
        發票日期: String(inv.發票日期 ?? "").trim().slice(0, 10) || "—",
        發票金額含稅: String(inv.發票金額含稅 ?? "").trim() || "—",
      })),
      KOL發票號碼: String(kolInv?.KOL發票號碼 ?? "").trim() || "",
      KOL發票日期: String(kolInv?.KOL發票日期 ?? "").trim().slice(0, 10) || "",
      KOL發票備註: String(kolInv?.KOL發票備註 ?? "").trim() || "",
      KOL發票填寫來源: String(kolInv?.填寫來源 ?? "").trim() || "",
      KOL發票填寫人: String(kolInv?.填寫人 ?? "").trim() || "",
      canEditKolInvoice: 結帳狀態 !== "已分潤",
    });
  }

  projects.sort((a, b) => a.專案ID.localeCompare(b.專案ID, "zh-Hant"));

  return {
    ok: true,
    partnerId,
    partnerName,
    projects,
  };
}
