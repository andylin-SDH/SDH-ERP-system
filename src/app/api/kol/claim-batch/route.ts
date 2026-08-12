/**
 * POST：KOL 批次請款（勾選多專案 → 發票同號套用 或 勞報拆單）
 */

import { NextRequest, NextResponse } from "next/server";
import { requireKol } from "@/lib/auth/api";
import { createKolClaimBatch } from "@/lib/db/kol-claim-batch";
import { getKolInvoicesByProjectIds } from "@/lib/db/kol-invoices";
import { getMasterList } from "@/lib/db/master";
import { getKolAccessibleProjectIds, resolveKolPartnerForUser } from "@/lib/kol/partner-bind";
import { savePartnerLaborProfile } from "@/lib/kol/partner-labor-profile";
import { isKolProjectOnHold } from "@/lib/kol/project-lifecycle";
import { getFinance } from "@/modules/finance";
import { kolClientHasCredited, kolFinanceProgressShort } from "@/lib/kol/finance-status";
import { parseKolAmount } from "@/lib/kol/format";

export const dynamic = "force-dynamic";

function fillerLabel(user: { name?: string | null; email?: string | null }): string {
  return String(user.name ?? "").trim() || String(user.email ?? "").trim();
}

export async function POST(request: NextRequest) {
  const auth = await requireKol(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = (await request.json()) as {
      專案IDs?: string[];
      請款方式?: "發票" | "勞務報酬";
      KOL發票號碼?: string | null;
      KOL發票日期?: string | null;
      KOL發票金額?: string | null;
      KOL發票備註?: string | null;
      勞務期間起?: string | null;
      勞務期間迄?: string | null;
      勞務內容?: string | null;
      身分證字號?: string | null;
      領款方式?: "現金" | "匯款" | null;
      聯絡電話?: string | null;
      戶籍地址?: string | null;
      勞報簽署?: boolean;
      勞報簽名?: string | null;
      勞報身分證正面?: string | null;
      勞報身分證反面?: string | null;
    } | null;

    const mode = body?.請款方式 === "勞務報酬" ? "勞務報酬" : "發票";
    const rawIds = Array.isArray(body?.專案IDs) ? body!.專案IDs! : [];
    const projectIds = [...new Set(rawIds.map((x) => String(x ?? "").trim()).filter(Boolean))];
    if (projectIds.length === 0) {
      return NextResponse.json({ ok: false, error: "請至少勾選一筆專案" }, { status: 400 });
    }

    const access = await getKolAccessibleProjectIds(auth.user);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
    }
    for (const pid of projectIds) {
      if (!access.projectIds.has(pid)) {
        return NextResponse.json({ ok: false, error: `無權限編輯專案 ${pid}` }, { status: 403 });
      }
    }

    const partner = await resolveKolPartnerForUser(auth.user);
    if (!partner.ok) {
      return NextResponse.json({ ok: false, error: partner.error }, { status: 403 });
    }

    const [financeList, kolInvByPid, masters] = await Promise.all([
      getFinance(),
      getKolInvoicesByProjectIds(projectIds),
      getMasterList(),
    ]);
    const financeByPid = new Map<string, (typeof financeList)[number]>();
    for (const f of financeList) {
      const pid = String(f.專案ID ?? "").trim();
      if (pid) financeByPid.set(pid, f);
    }
    const masterByPid = new Map(
      masters
        .map((m) => [String(m.專案ID ?? "").trim(), m] as const)
        .filter(([pid]) => Boolean(pid))
    );

    const projects: Array<{ 專案ID: string; 金額: number; 專案名稱?: string }> = [];
    for (const pid of projectIds) {
      const master = masterByPid.get(pid);
      if (!master) {
        return NextResponse.json({ ok: false, error: `找不到專案 ${pid}` }, { status: 400 });
      }
      if (isKolProjectOnHold(master.專案狀態)) {
        return NextResponse.json(
          { ok: false, error: `專案 ${pid} 目前為暫緩狀態，無法請款` },
          { status: 400 }
        );
      }
      const f = financeByPid.get(pid);
      if (!kolClientHasCredited(f?.廠商付款日期)) {
        return NextResponse.json(
          { ok: false, error: `專案 ${pid} 客戶尚未入帳，無法請款` },
          { status: 400 }
        );
      }
      const kolInv = kolInvByPid.get(pid);
      const status = kolFinanceProgressShort(f?.廠商付款日期, kolInv, kolInv?.KOL匯款日期);
      if (status === "已匯款") {
        return NextResponse.json({ ok: false, error: `專案 ${pid} 已匯款，無法修改請款憑證` }, { status: 400 });
      }
      if (status !== "可請款") {
        return NextResponse.json(
          { ok: false, error: `專案 ${pid} 目前為「${status}」，僅可請款狀態可納入批次` },
          { status: 400 }
        );
      }
      const amt = Math.round(parseKolAmount(master.KOL費用未稅));
      if (amt <= 0) {
        return NextResponse.json({ ok: false, error: `專案 ${pid} 的 KOL費用未稅無效` }, { status: 400 });
      }
      projects.push({
        專案ID: pid,
        金額: amt,
        專案名稱: String(master.專案名稱 ?? "").trim() || undefined,
      });
    }

    const 填寫人 = fillerLabel(auth.user);
    const result = await createKolClaimBatch({
      partnerId: partner.binding.partnerId,
      projects,
      請款方式: mode,
      KOL發票號碼: body?.KOL發票號碼,
      KOL發票日期: body?.KOL發票日期,
      KOL發票金額: body?.KOL發票金額,
      KOL發票備註: body?.KOL發票備註,
      勞務期間起: body?.勞務期間起,
      勞務期間迄: body?.勞務期間迄,
      勞務內容: body?.勞務內容,
      身分證字號: body?.身分證字號,
      領款方式: body?.領款方式 ?? "現金",
      聯絡電話: body?.聯絡電話,
      戶籍地址: body?.戶籍地址,
      勞報簽署: body?.勞報簽署,
      勞報簽名: body?.勞報簽名,
      勞報身分證正面: body?.勞報身分證正面,
      勞報身分證反面: body?.勞報身分證反面,
      填寫人,
      填寫來源: "KOL",
    });

    if (mode === "勞務報酬") {
      await savePartnerLaborProfile(partner.binding.partnerId, {
        身分證字號: String(body?.身分證字號 ?? "").trim(),
        聯絡電話: String(body?.聯絡電話 ?? "").trim(),
        戶籍地址: String(body?.戶籍地址 ?? "").trim(),
        身分證正面: String(body?.勞報身分證正面 ?? "").trim() || undefined,
        身分證反面: String(body?.勞報身分證反面 ?? "").trim() || undefined,
      });
    }

    return NextResponse.json({
      ok: true,
      batchId: result.batchId,
      updated: result.updated.length,
      split: result.split
        ? {
            total: result.split.total,
            slips: result.split.slips,
          }
        : null,
    });
  } catch (e) {
    console.error("POST /api/kol/claim-batch", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "批次請款失敗" },
      { status: 500 }
    );
  }
}
