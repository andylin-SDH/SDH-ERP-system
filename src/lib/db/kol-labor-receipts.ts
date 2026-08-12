/**
 * 後台匯出勞務報酬收據：依專案組裝單張或批次拆單
 */

import { getSupabase } from "@/lib/supabase/server";
import { getMasterList } from "@/lib/db/master";
import { getKolInvoiceByProjectId } from "@/lib/db/kol-invoices";
import { kolHasRequestCredential, kolRequestMode } from "@/lib/kol/finance-status";
import type { LaborPaymentMethod } from "@/lib/kol/labor-receipt";
import { log } from "@/lib/log";

export type LaborReceiptSlipExport = {
  序號: number;
  應領金額: number;
  扣繳稅額: number;
  二代健保費: number;
  實領金額: number;
  備註: string;
};

export type LaborReceiptExport = {
  專案ID: string;
  專案名稱: string;
  KOL名稱: string;
  請款批次ID: string;
  收據日期: string;
  領款方式: LaborPaymentMethod;
  身分證字號: string;
  聯絡電話: string;
  戶籍地址: string;
  勞務內容: string;
  勞務期間起: string;
  勞務期間迄: string;
  勞報簽名: string;
  身分證正面: string;
  身分證反面: string;
  單據: LaborReceiptSlipExport[];
};

function isMissingTableError(error: { code?: string | null; message?: string | null }): boolean {
  const code = String(error.code ?? "");
  if (code === "42P01" || code === "PGRST205") return true;
  const msg = String(error.message ?? "");
  return msg.includes("schema cache") || msg.includes("does not exist");
}

function sliceDate(raw: unknown): string {
  return String(raw ?? "").trim().slice(0, 10);
}

function toInt(raw: unknown): number {
  const n = Math.round(Number(String(raw ?? "").replace(/,/g, "")) || 0);
  return n > 0 ? n : 0;
}

async function getBatchLaborSlips(batchId: string): Promise<LaborReceiptSlipExport[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("KOL勞報單據")
    .select('id,"序號","給付總額"')
    .eq("批次ID", batchId)
    .order("序號", { ascending: true });
  if (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
  return (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    const amt = toInt(r.給付總額);
    return {
      序號: Number(r.序號) || 0,
      應領金額: amt,
      扣繳稅額: 0,
      二代健保費: 0,
      實領金額: amt,
      備註: `勞報單據 #${Number(r.序號) || 0}`,
    };
  });
}

async function getBatchHeader(batchId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await getSupabase()
    .from("KOL請款批次")
    .select(
      'id,"請款方式","勞務期間起","勞務期間迄","勞務內容","身分證字號","領款方式","聯絡電話","戶籍地址","勞報簽名","勞報簽署時間","勞報身分證正面","勞報身分證反面"'
    )
    .eq("id", batchId)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
  return (data as Record<string, unknown> | null) ?? null;
}

/** 依專案組裝可列印／下載的勞報收據（批次則回傳全部拆單） */
export async function getLaborReceiptExportByProjectId(專案ID: string): Promise<LaborReceiptExport> {
  const pid = String(專案ID ?? "").trim();
  if (!pid) throw new Error("專案ID 為必填");

  const [masters, kolInv] = await Promise.all([getMasterList(), getKolInvoiceByProjectId(pid)]);
  const master = masters.find((m) => String(m.專案ID ?? "").trim() === pid);
  if (!master) throw new Error("找不到專案");
  if (!kolInv || kolRequestMode(kolInv) !== "勞務報酬" || !kolHasRequestCredential(kolInv)) {
    throw new Error("此專案尚未完成勞務報酬請款");
  }

  const kolName = String(master.KOL名稱 ?? "").trim() || "—";
  const projectName = String(master.專案名稱 ?? "").trim() || "—";
  const batchId = String(kolInv.請款批次ID ?? "").trim();

  let 領款方式: LaborPaymentMethod = kolInv.領款方式 === "匯款" ? "匯款" : "現金";
  let 身分證字號 = String(kolInv.身分證字號 ?? "").trim();
  let 聯絡電話 = String(kolInv.聯絡電話 ?? "").trim();
  let 戶籍地址 = String(kolInv.戶籍地址 ?? "").trim();
  let 勞務內容 = String(kolInv.勞務內容 ?? "").trim();
  let 勞務期間起 = sliceDate(kolInv.勞務期間起);
  let 勞務期間迄 = sliceDate(kolInv.勞務期間迄);
  let 勞報簽名 = String(kolInv.勞報簽名 ?? "").trim();
  let 身分證正面 = String(kolInv.勞報身分證正面 ?? "").trim();
  let 身分證反面 = String(kolInv.勞報身分證反面 ?? "").trim();
  let 收據日期 = sliceDate(kolInv.勞報簽署時間) || sliceDate(kolInv.KOL匯款日期);

  let 單據: LaborReceiptSlipExport[] = [];

  if (batchId) {
    try {
      const [header, slips] = await Promise.all([getBatchHeader(batchId), getBatchLaborSlips(batchId)]);
      if (header) {
        領款方式 = header["領款方式"] === "匯款" ? "匯款" : "現金";
        身分證字號 = String(header["身分證字號"] ?? 身分證字號).trim();
        聯絡電話 = String(header["聯絡電話"] ?? 聯絡電話).trim();
        戶籍地址 = String(header["戶籍地址"] ?? 戶籍地址).trim();
        勞務內容 = String(header["勞務內容"] ?? 勞務內容).trim();
        勞務期間起 = sliceDate(header["勞務期間起"]) || 勞務期間起;
        勞務期間迄 = sliceDate(header["勞務期間迄"]) || 勞務期間迄;
        勞報簽名 = String(header["勞報簽名"] ?? 勞報簽名).trim();
        身分證正面 = String(header["勞報身分證正面"] ?? 身分證正面).trim();
        身分證反面 = String(header["勞報身分證反面"] ?? 身分證反面).trim();
        收據日期 = sliceDate(header["勞報簽署時間"]) || 收據日期;
      }
      單據 = slips.map((s) => ({
        ...s,
        備註:
          勞務期間起 && 勞務期間迄
            ? `${勞務內容 || "勞務報酬"}（${勞務期間起}～${勞務期間迄}）· 單據 #${s.序號}`
            : `${勞務內容 || "勞務報酬"} · 單據 #${s.序號}`,
      }));
    } catch (e) {
      log("kol-labor-receipts", "讀取批次勞報單據失敗，改用專案單據", {
        batchId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (單據.length === 0) {
    const gross = toInt(kolInv.給付總額) || toInt(master.KOL費用未稅);
    const tax = toInt(kolInv.扣繳稅額);
    const nhi = toInt(kolInv.二代健保費);
    const net = toInt(kolInv.實領金額) || Math.max(0, gross - tax - nhi);
    單據 = [
      {
        序號: 1,
        應領金額: gross,
        扣繳稅額: tax,
        二代健保費: nhi,
        實領金額: net,
        備註:
          勞務期間起 && 勞務期間迄
            ? `${勞務內容 || "勞務報酬"}（${勞務期間起}～${勞務期間迄}）`
            : 勞務內容 || "勞務報酬",
      },
    ];
  }

  if (!收據日期) 收據日期 = new Date().toISOString().slice(0, 10);

  return {
    專案ID: pid,
    專案名稱: projectName,
    KOL名稱: kolName,
    請款批次ID: batchId,
    收據日期,
    領款方式,
    身分證字號,
    聯絡電話,
    戶籍地址,
    勞務內容,
    勞務期間起,
    勞務期間迄,
    勞報簽名,
    身分證正面,
    身分證反面,
    單據,
  };
}
