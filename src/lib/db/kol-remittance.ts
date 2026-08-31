/**
 * KOL 匯款：財務待匯款／已匯款清單與登記
 */

import { getMasterList } from "@/lib/db/master";
import {
  getAllKolInvoices,
  setKolRemittance,
  setKolRemittanceForAdvance,
  clearKolRemittance,
} from "@/lib/db/kol-invoices";
import { getPartnersApprovedWithError } from "@/lib/db/partners";
import { createPaymentRecordsBatch, deleteKolPaymentRecordsForProject } from "@/lib/db/finance";
import { getFinance } from "@/modules/finance";
import {
  kolClientHasCredited,
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
  /** 對應合作夥伴 PartnerID（供開啟老師視角預覽） */
  PartnerID: string;
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
  /** 已匯款且廠商尚未入帳＝代墊 */
  代墊: boolean;
}

export type RegisterKolRemittanceInput = {
  專案ID: string;
  匯款日期: string;
  匯款金額?: string | null;
  付款對象?: string | null;
  備註?: string | null;
  登記人: string;
  /** 代墊：允許廠商未入帳、無請款憑證時登記（僅董事長／會計 API 可開） */
  代墊?: boolean;
};

export interface KolAdvanceRemittanceCandidate {
  專案ID: string;
  專案名稱: string;
  KOL名稱: string;
  PartnerID: string;
  KOL費用未稅: string;
  廠商付款日期: string;
  結帳狀態: string;
  預設匯款金額: string;
}

function formatMoney(raw: unknown): string {
  return normalizeDecimalString(raw, 2) ?? "";
}

const ADVANCE_NOTE_PREFIX = "代墊：廠商尚未入帳";

export async function getKolRemittanceList(): Promise<KolRemittanceListItem[]> {
  const [masters, financeList, kolInvoices, { partners }] = await Promise.all([
    getMasterList(),
    getFinance(),
    getAllKolInvoices(),
    getPartnersApprovedWithError(),
  ]);

  const financeByPid = new Map<string, (typeof financeList)[number]>();
  for (const f of financeList) {
    const pid = String(f.專案ID ?? "").trim();
    if (pid) financeByPid.set(pid, f);
  }

  const partnerIdByName = new Map<string, string>();
  for (const p of partners) {
    const name = String(p.合作夥伴名稱 ?? "").trim();
    const id = String(p.PartnerID ?? "").trim();
    if (name && id && !partnerIdByName.has(name)) partnerIdByName.set(name, id);
  }

  const kolInvByPid = new Map(kolInvoices.map((k) => [k.專案ID, k]));
  const items: KolRemittanceListItem[] = [];

  for (const row of masters) {
    const pid = String(row.專案ID ?? "").trim();
    const kolName = String(row.KOL名稱 ?? "").trim();
    if (!pid || !kolName) continue;

    const f = financeByPid.get(pid);
    const kolInv = kolInvByPid.get(pid);
    const 廠商付款日期 = String(f?.廠商付款日期 ?? "").trim().slice(0, 10) || "";
    const 結帳狀態 = kolFinanceProgressShort(f?.廠商付款日期, kolInv, kolInv?.KOL匯款日期);
    if (結帳狀態 !== "待匯款" && 結帳狀態 !== "已匯款") continue;

    const 代墊 = 結帳狀態 === "已匯款" && !kolClientHasCredited(廠商付款日期);

    items.push({
      專案ID: pid,
      專案名稱: String(row.專案名稱 ?? "").trim() || "—",
      KOL名稱: kolName,
      PartnerID: partnerIdByName.get(kolName) ?? "",
      KOL費用未稅: formatMoney(row.KOL費用未稅),
      廠商付款日期,
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
      代墊,
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

/** 代墊候選：有 KOL、尚未匯款、廠商未入帳（未入帳） */
export async function getKolAdvanceRemittanceCandidates(): Promise<KolAdvanceRemittanceCandidate[]> {
  const [masters, financeList, kolInvoices, { partners }] = await Promise.all([
    getMasterList(),
    getFinance(),
    getAllKolInvoices(),
    getPartnersApprovedWithError(),
  ]);

  const financeByPid = new Map<string, (typeof financeList)[number]>();
  for (const f of financeList) {
    const pid = String(f.專案ID ?? "").trim();
    if (pid) financeByPid.set(pid, f);
  }

  const partnerIdByName = new Map<string, string>();
  for (const p of partners) {
    const name = String(p.合作夥伴名稱 ?? "").trim();
    const id = String(p.PartnerID ?? "").trim();
    if (name && id && !partnerIdByName.has(name)) partnerIdByName.set(name, id);
  }

  const kolInvByPid = new Map(kolInvoices.map((k) => [k.專案ID, k]));
  const items: KolAdvanceRemittanceCandidate[] = [];

  for (const row of masters) {
    const pid = String(row.專案ID ?? "").trim();
    const kolName = String(row.KOL名稱 ?? "").trim();
    if (!pid || !kolName) continue;

    const f = financeByPid.get(pid);
    const kolInv = kolInvByPid.get(pid);
    const 結帳狀態 = kolFinanceProgressShort(f?.廠商付款日期, kolInv, kolInv?.KOL匯款日期);
    if (結帳狀態 !== "未入帳") continue;

    const 預設匯款金額 =
      kolRequestMode(kolInv) === "勞務報酬"
        ? formatMoney(kolInv?.實領金額) || formatMoney(kolInv?.給付總額) || formatMoney(row.KOL費用未稅)
        : formatMoney(row.KOL費用未稅);

    items.push({
      專案ID: pid,
      專案名稱: String(row.專案名稱 ?? "").trim() || "—",
      KOL名稱: kolName,
      PartnerID: partnerIdByName.get(kolName) ?? "",
      KOL費用未稅: formatMoney(row.KOL費用未稅),
      廠商付款日期: String(f?.廠商付款日期 ?? "").trim().slice(0, 10) || "",
      結帳狀態,
      預設匯款金額,
    });
  }

  items.sort((a, b) => a.專案ID.localeCompare(b.專案ID, "zh-Hant"));
  return items;
}

export async function registerKolRemittance(input: RegisterKolRemittanceInput): Promise<{
  invoice: Awaited<ReturnType<typeof setKolRemittance>>;
  payment: Awaited<ReturnType<typeof createPaymentRecordsBatch>>[number];
}> {
  const pid = String(input.專案ID ?? "").trim();
  let 匯款日期 = String(input.匯款日期 ?? "").trim().slice(0, 10);
  if (!pid) throw new Error("專案ID 為必填");
  if (!匯款日期) 匯款日期 = new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(匯款日期)) throw new Error("請填寫有效的匯款日期");

  const isAdvance = Boolean(input.代墊);

  const masters = await getMasterList();
  const master = masters.find((m) => String(m.專案ID ?? "").trim() === pid);
  if (!master) throw new Error("找不到專案");
  if (!String(master.KOL名稱 ?? "").trim()) throw new Error("此專案無 KOL 名稱，無法登記 KOL 匯款");

  const financeList = await getFinance();
  const finance = financeList.find((f) => String(f.專案ID ?? "").trim() === pid);
  const vendorPaid = kolClientHasCredited(finance?.廠商付款日期);

  if (isAdvance) {
    if (vendorPaid) {
      throw new Error("此專案廠商已入帳，請走一般「待匯款 → 登記匯款」流程，勿使用代墊");
    }
  }

  const kolInvoices = await getAllKolInvoices();
  const kolInv = kolInvoices.find((k) => k.專案ID === pid);

  if (!isAdvance) {
    if (!kolInv || !kolHasRequestCredential(kolInv)) {
      throw new Error("此專案請款憑證尚未完成（發票或勞務報酬單）");
    }
  }
  if (kolInv && String(kolInv.KOL匯款日期 ?? "").trim()) {
    throw new Error("此專案已登記匯款");
  }

  const kolName = String(master.KOL名稱 ?? "").trim();
  const defaultAmount =
    kolInv && kolRequestMode(kolInv) === "勞務報酬"
      ? formatMoney(kolInv.實領金額) || formatMoney(kolInv.給付總額) || formatMoney(master.KOL費用未稅)
      : formatMoney(master.KOL費用未稅);
  const amtRaw = String(input.匯款金額 ?? "").trim().replace(/,/g, "");
  const 匯款金額 = amtRaw || defaultAmount;
  const 付款對象 = String(input.付款對象 ?? "").trim() || kolName;
  const 備註 = String(input.備註 ?? "").trim();
  const 登記人 = String(input.登記人 ?? "").trim();
  const credLabel = kolInv ? kolRequestCredentialLabel(kolInv) : "";

  let paymentNote: string;
  if (isAdvance) {
    paymentNote = 備註.includes("代墊")
      ? 備註
      : 備註
        ? `${ADVANCE_NOTE_PREFIX}｜${備註} · ${登記人}`
        : `${ADVANCE_NOTE_PREFIX} · ${登記人}`;
  } else {
    paymentNote =
      備註 ||
      (kolInv && kolRequestMode(kolInv) === "勞務報酬"
        ? `KOL勞報匯款 · ${登記人}`
        : `KOL匯款 · ${登記人}`);
  }

  const [payment] = await createPaymentRecordsBatch([
    {
      發票號碼:
        kolInv && kolRequestMode(kolInv) === "勞務報酬"
          ? `勞報-${pid}`
          : String(kolInv?.KOL發票號碼 ?? "").trim() || (isAdvance ? `代墊-${pid}` : null),
      付款日期: 匯款日期,
      付款專案: pid,
      付款對象,
      付款金額: 匯款金額 || null,
      備註: credLabel ? `${paymentNote} · ${credLabel}` : paymentNote,
      匯款類型: "KOL",
    },
  ]);

  const invoice = isAdvance
    ? await setKolRemittanceForAdvance(pid, {
        KOL匯款日期: 匯款日期,
        KOL匯款金額: 匯款金額 || null,
        登記人,
      })
    : await setKolRemittance(pid, {
        KOL匯款日期: 匯款日期,
        KOL匯款金額: 匯款金額 || null,
      });

  return { invoice, payment };
}

export async function registerKolRemittanceBatch(
  items: RegisterKolRemittanceInput[]
): Promise<{ ok: string[]; failed: Array<{ 專案ID: string; error: string }> }> {
  const ok: string[] = [];
  const failed: Array<{ 專案ID: string; error: string }> = [];
  for (const item of items) {
    const pid = String(item.專案ID ?? "").trim();
    try {
      if (item.代墊) {
        throw new Error("批次登記不支援代墊，請逐筆使用代墊匯款");
      }
      await registerKolRemittance(item);
      ok.push(pid);
    } catch (e) {
      failed.push({ 專案ID: pid || "—", error: e instanceof Error ? e.message : "登記失敗" });
    }
  }
  if (ok.length === 0 && failed.length > 0) {
    throw new Error(failed.map((f) => `${f.專案ID}：${f.error}`).join("；"));
  }
  return { ok, failed };
}

/**
 * 撤回誤點的「登記匯款」：
 * - 清空 KOL發票 匯款日／金額（憑證保留）
 * - 刪除該專案匯款類型為 KOL 的付款記錄
 * 狀態回到待匯款（或代墊時的未入帳）。
 */
export async function revokeKolRemittance(專案ID: string): Promise<{
  invoice: Awaited<ReturnType<typeof clearKolRemittance>>;
  deletedPayments: number;
}> {
  const pid = String(專案ID ?? "").trim();
  if (!pid) throw new Error("專案ID 為必填");

  const invoice = await clearKolRemittance(pid);
  const deletedPayments = await deleteKolPaymentRecordsForProject(pid);
  return { invoice, deletedPayments };
}
