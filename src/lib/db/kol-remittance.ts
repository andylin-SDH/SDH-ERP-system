/**
 * KOL 匯款：財務待匯款／已匯款清單與登記
 */

import { getMasterList } from "@/lib/db/master";
import { getAllKolInvoices, setKolRemittance } from "@/lib/db/kol-invoices";
import { createPaymentRecordsBatch } from "@/lib/db/finance";
import { getFinance } from "@/modules/finance";
import {
  kolFinanceProgressShort,
  kolHasRequestCredential,
  kolRequestCredentialLabel,
  kolRequestMode,
} from "@/lib/kol/finance-status";
import { normalizeDecimalString } from "@/lib/number-normalize";

export interface KolRemittanceListItem {
  專案ID: string;
  專案名稱: string;
  KOL名稱: string;
  KOL費用未稅: string;
  廠商付款日期: string;
  請款方式: string;
  請款憑證摘要: string;
  KOL發票號碼: string;
  KOL發票日期: string;
  勞務期間起: string;
  勞務期間迄: string;
  給付總額: string;
  實領金額: string;
  KOL匯款日期: string;
  KOL匯款金額: string;
  結帳狀態: string;
}

export type RegisterKolRemittanceInput = {
  專案ID: string;
  匯款日期: string;
  匯款金額?: string | null;
  付款對象?: string | null;
  備註?: string | null;
  登記人: string;
};

function formatMoney(raw: unknown): string {
  return normalizeDecimalString(raw, 2) ?? "";
}

export async function getKolRemittanceList(): Promise<KolRemittanceListItem[]> {
  const [masters, financeList, kolInvoices] = await Promise.all([
    getMasterList(),
    getFinance(),
    getAllKolInvoices(),
  ]);

  const financeByPid = new Map<string, (typeof financeList)[number]>();
  for (const f of financeList) {
    const pid = String(f.專案ID ?? "").trim();
    if (pid) financeByPid.set(pid, f);
  }

  const kolInvByPid = new Map(kolInvoices.map((k) => [k.專案ID, k]));
  const items: KolRemittanceListItem[] = [];

  for (const row of masters) {
    const pid = String(row.專案ID ?? "").trim();
    const kolName = String(row.KOL名稱 ?? "").trim();
    if (!pid || !kolName) continue;

    const f = financeByPid.get(pid);
    const kolInv = kolInvByPid.get(pid);
    const 結帳狀態 = kolFinanceProgressShort(f?.廠商付款日期, kolInv, kolInv?.KOL匯款日期);
    if (結帳狀態 !== "待匯款" && 結帳狀態 !== "已匯款") continue;

    items.push({
      專案ID: pid,
      專案名稱: String(row.專案名稱 ?? "").trim() || "—",
      KOL名稱: kolName,
      KOL費用未稅: formatMoney(row.KOL費用未稅),
      廠商付款日期: String(f?.廠商付款日期 ?? "").trim().slice(0, 10) || "",
      請款方式: kolRequestMode(kolInv),
      請款憑證摘要: kolRequestCredentialLabel(kolInv),
      KOL發票號碼: String(kolInv?.KOL發票號碼 ?? "").trim(),
      KOL發票日期: String(kolInv?.KOL發票日期 ?? "").trim().slice(0, 10) || "",
      勞務期間起: String(kolInv?.勞務期間起 ?? "").trim().slice(0, 10) || "",
      勞務期間迄: String(kolInv?.勞務期間迄 ?? "").trim().slice(0, 10) || "",
      給付總額: formatMoney(kolInv?.給付總額 || row.KOL費用未稅),
      實領金額: formatMoney(kolInv?.實領金額),
      KOL匯款日期: String(kolInv?.KOL匯款日期 ?? "").trim().slice(0, 10) || "",
      KOL匯款金額: formatMoney(kolInv?.KOL匯款金額),
      結帳狀態,
    });
  }

  items.sort((a, b) => {
    const statusOrder = (s: string) => (s === "待匯款" ? 0 : 1);
    const d = statusOrder(a.結帳狀態) - statusOrder(b.結帳狀態);
    if (d !== 0) return d;
    return a.專案ID.localeCompare(b.專案ID, "zh-Hant");
  });

  return items;
}

export async function registerKolRemittance(input: RegisterKolRemittanceInput): Promise<{
  invoice: Awaited<ReturnType<typeof setKolRemittance>>;
  payment: Awaited<ReturnType<typeof createPaymentRecordsBatch>>[number];
}> {
  const pid = String(input.專案ID ?? "").trim();
  const 匯款日期 = String(input.匯款日期 ?? "").trim().slice(0, 10);
  if (!pid) throw new Error("專案ID 為必填");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(匯款日期)) throw new Error("請填寫有效的匯款日期");

  const masters = await getMasterList();
  const master = masters.find((m) => String(m.專案ID ?? "").trim() === pid);
  if (!master) throw new Error("找不到專案");

  const kolInvoices = await getAllKolInvoices();
  const kolInv = kolInvoices.find((k) => k.專案ID === pid);
  if (!kolInv || !kolHasRequestCredential(kolInv)) {
    throw new Error("此專案請款憑證尚未完成（發票或勞務報酬單）");
  }
  if (String(kolInv.KOL匯款日期 ?? "").trim()) {
    throw new Error("此專案已登記匯款");
  }

  const kolName = String(master.KOL名稱 ?? "").trim();
  const defaultAmount =
    kolRequestMode(kolInv) === "勞務報酬"
      ? formatMoney(kolInv.實領金額) || formatMoney(kolInv.給付總額) || formatMoney(master.KOL費用未稅)
      : formatMoney(master.KOL費用未稅);
  const amtRaw = String(input.匯款金額 ?? "").trim().replace(/,/g, "");
  const 匯款金額 = amtRaw || defaultAmount;
  const 付款對象 = String(input.付款對象 ?? "").trim() || kolName;
  const 備註 = String(input.備註 ?? "").trim();
  const 登記人 = String(input.登記人 ?? "").trim();
  const credLabel = kolRequestCredentialLabel(kolInv);
  const paymentNote =
    備註 ||
    (kolRequestMode(kolInv) === "勞務報酬"
      ? `KOL勞報匯款 · ${登記人}`
      : `KOL匯款 · ${登記人}`);

  const [payment] = await createPaymentRecordsBatch([
    {
      發票號碼:
        kolRequestMode(kolInv) === "勞務報酬"
          ? `勞報-${pid}`
          : String(kolInv.KOL發票號碼 ?? "").trim() || null,
      付款日期: 匯款日期,
      付款專案: pid,
      付款對象,
      付款金額: 匯款金額 || null,
      備註: credLabel ? `${paymentNote} · ${credLabel}` : paymentNote,
      匯款類型: "KOL",
    },
  ]);

  const invoice = await setKolRemittance(pid, {
    KOL匯款日期: 匯款日期,
    KOL匯款金額: 匯款金額 || null,
  });

  return { invoice, payment };
}
