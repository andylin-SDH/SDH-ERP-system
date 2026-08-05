/**
 * KOL（老師）專用總覽：依 partners 對應大總表 KOL 名稱，串依專案財務／發票／KOL 請款發票
 */

import type { User } from "@/lib/types";
import type { FinanceRow } from "@/modules/finance";
import type { InvoiceRow } from "@/modules/finance";
import { getMasterList } from "@/lib/db/master";
import { getKolInvoicesByProjectIds } from "@/lib/db/kol-invoices";
import { getPartnersApprovedWithError } from "@/lib/db/partners";
import { getFinance, getInvoices } from "@/modules/finance";
import {
  kolCanEditRequestCredential,
  kolFinanceProgressShort,
  kolRequestCredentialLabel,
  kolRequestMode,
} from "@/lib/kol/finance-status";
import { formatKolAmountInt, parseKolAmount, sumKolInvoiceAmount含稅 } from "@/lib/kol/format";
import { resolveKolPartnerForUser } from "@/lib/kol/partner-bind";
import { getPartnerLaborProfile } from "@/lib/kol/partner-labor-profile";
import { isKolProjectOnHold } from "@/lib/kol/project-lifecycle";
import type { KolPortalProject } from "@/lib/kol/types";

export type { KolPortalProject } from "@/lib/kol/types";

export type KolPortalDataOk = {
  ok: true;
  partnerId: string;
  partnerName: string;
  laborProfile: { 身分證字號: string; 聯絡電話: string; 戶籍地址: string };
  projects: KolPortalProject[];
};

export type KolPortalDataResult = KolPortalDataOk | { ok: false; error: string };

export type KolPortalPreviewOption = {
  partnerId: string;
  partnerName: string;
  projectCount: number;
};

/** 員工預覽可用：大總表有掛名的 KOL（合作夥伴）清單 */
export async function listKolPortalPreviewOptions(): Promise<KolPortalPreviewOption[]> {
  const [{ partners }, masters] = await Promise.all([getPartnersApprovedWithError(), getMasterList()]);
  const countByName = new Map<string, number>();
  for (const row of masters) {
    const name = String(row.KOL名稱 ?? "").trim();
    if (!name) continue;
    countByName.set(name, (countByName.get(name) ?? 0) + 1);
  }
  const options: KolPortalPreviewOption[] = [];
  for (const p of partners) {
    const partnerId = String(p.PartnerID ?? "").trim();
    const partnerName = String(p.合作夥伴名稱 ?? "").trim();
    if (!partnerId || !partnerName) continue;
    const projectCount = countByName.get(partnerName) ?? 0;
    if (projectCount <= 0) continue;
    options.push({ partnerId, partnerName, projectCount });
  }
  options.sort((a, b) => a.partnerName.localeCompare(b.partnerName, "zh-Hant"));
  return options;
}

export async function buildKolPortalDataByPartnerId(
  partnerIdInput: string,
  options?: { forceReadOnly?: boolean }
): Promise<KolPortalDataResult> {
  const partnerId = String(partnerIdInput ?? "").trim();
  if (!partnerId) return { ok: false, error: "缺少 PartnerID" };

  const { partners, error } = await getPartnersApprovedWithError();
  if (error && !partners.length) {
    return { ok: false, error: error || "無法讀取合作夥伴資料" };
  }
  const partner = partners.find((x) => String(x.PartnerID ?? "").trim() === partnerId);
  if (!partner) {
    return { ok: false, error: `找不到 PartnerID「${partnerId}」的 KOL。` };
  }
  const partnerName = String(partner.合作夥伴名稱 ?? "").trim();
  if (!partnerName) {
    return { ok: false, error: "合作夥伴名稱空白，無法對應專案。" };
  }

  return buildKolPortalDataForPartner(partnerId, partnerName, options);
}

async function buildKolPortalDataForPartner(
  partnerId: string,
  partnerName: string,
  options?: { forceReadOnly?: boolean }
): Promise<KolPortalDataResult> {
  const forceReadOnly = Boolean(options?.forceReadOnly);

  const [masterList, financeList, invoiceList, laborProfile] = await Promise.all([
    getMasterList(),
    getFinance(),
    getInvoices(),
    getPartnerLaborProfile(partnerId),
  ]);

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

  const kolInvoiceByPid = await getKolInvoicesByProjectIds(matchedPids).catch((e) => {
    console.warn("buildKolPortalData: KOL發票讀取失敗，略過", e);
    return new Map();
  });

  const projects: KolPortalProject[] = [];
  for (const row of masterList) {
    if (String(row.KOL名稱 ?? "").trim() !== partnerName) continue;
    const pid = String(row.專案ID ?? "").trim();
    if (!pid) continue;
    const f = financeByPid.get(pid);
    const invs = invoicesByPid.get(pid) ?? [];
    const kolInv = kolInvoiceByPid.get(pid);
    const 結帳狀態 = kolFinanceProgressShort(f?.廠商付款日期, kolInv, kolInv?.KOL匯款日期);
    const mode = kolRequestMode(kolInv);
    const canEdit =
      !forceReadOnly &&
      !isKolProjectOnHold(row.專案狀態) &&
      kolCanEditRequestCredential(f?.廠商付款日期, kolInv, kolInv?.KOL匯款日期);
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
      請款方式: mode,
      KOL發票號碼: String(kolInv?.KOL發票號碼 ?? "").trim() || "",
      KOL發票日期: String(kolInv?.KOL發票日期 ?? "").trim().slice(0, 10) || "",
      KOL發票備註: String(kolInv?.KOL發票備註 ?? "").trim() || "",
      勞務期間起: String(kolInv?.勞務期間起 ?? "").trim().slice(0, 10) || "",
      勞務期間迄: String(kolInv?.勞務期間迄 ?? "").trim().slice(0, 10) || "",
      勞務內容: String(kolInv?.勞務內容 ?? "").trim() || "",
      給付總額: formatKolAmountInt(parseKolAmount(kolInv?.給付總額 || row.KOL費用未稅)),
      身分證字號: String(kolInv?.身分證字號 ?? laborProfile.身分證字號 ?? "").trim() || "",
      勞報領款方式: kolInv?.領款方式 === "匯款" ? "匯款" : "現金",
      聯絡電話: String(kolInv?.聯絡電話 ?? laborProfile.聯絡電話 ?? "").trim() || "",
      戶籍地址: String(kolInv?.戶籍地址 ?? laborProfile.戶籍地址 ?? "").trim() || "",
      扣繳稅額: formatKolAmountInt(parseKolAmount(kolInv?.扣繳稅額)),
      二代健保費: formatKolAmountInt(parseKolAmount(kolInv?.二代健保費)),
      實領金額: formatKolAmountInt(parseKolAmount(kolInv?.實領金額 || kolInv?.給付總額)),
      勞報簽署時間: String(kolInv?.勞報簽署時間 ?? "").trim() || "",
      勞報簽名: String(kolInv?.勞報簽名 ?? "").trim() || "",
      請款憑證摘要: kolRequestCredentialLabel(kolInv),
      KOL發票填寫來源: String(kolInv?.填寫來源 ?? "").trim() || "",
      KOL發票填寫人: String(kolInv?.填寫人 ?? "").trim() || "",
      KOL匯款日期: String(kolInv?.KOL匯款日期 ?? "").trim().slice(0, 10) || "",
      KOL匯款金額: formatKolAmountInt(parseKolAmount(kolInv?.KOL匯款金額)),
      canEditKolInvoice: canEdit,
    });
  }

  projects.sort((a, b) => a.專案ID.localeCompare(b.專案ID, "zh-Hant"));

  return {
    ok: true,
    partnerId,
    partnerName,
    laborProfile,
    projects,
  };
}

export async function buildKolPortalData(user: User): Promise<KolPortalDataResult> {
  const resolved = await resolveKolPartnerForUser(user);
  if (!resolved.ok) return resolved;

  const { partnerId, partnerName } = resolved.binding;
  if (!partnerName) {
    return { ok: false, error: "合作夥伴名稱空白，無法對應專案。" };
  }

  return buildKolPortalDataForPartner(partnerId, partnerName);
}
