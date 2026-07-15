/**
 * PATCH：KOL 填寫／更新請款憑證（發票或勞務報酬；已匯款不可改）
 */

import { NextRequest, NextResponse } from "next/server";
import { requireKol } from "@/lib/auth/api";
import { getKolInvoicesByProjectIds, upsertKolInvoice } from "@/lib/db/kol-invoices";
import { getKolAccessibleProjectIds, resolveKolPartnerForUser } from "@/lib/kol/partner-bind";
import { savePartnerLaborProfile } from "@/lib/kol/partner-labor-profile";
import { getFinance } from "@/modules/finance";
import { kolClientHasCredited, kolFinanceProgressShort } from "@/lib/kol/finance-status";

export const dynamic = "force-dynamic";

function fillerLabel(user: { name?: string | null; email?: string | null }): string {
  return String(user.name ?? "").trim() || String(user.email ?? "").trim();
}

export async function PATCH(request: NextRequest) {
  const auth = await requireKol(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await request.json()) as {
      專案ID?: string;
      請款方式?: "發票" | "勞務報酬";
      KOL發票號碼?: string | null;
      KOL發票日期?: string | null;
      KOL發票備註?: string | null;
      勞務期間起?: string | null;
      勞務期間迄?: string | null;
      勞務內容?: string | null;
      給付總額?: string | null;
      身分證字號?: string | null;
      領款方式?: "現金" | "匯款" | null;
      聯絡電話?: string | null;
      戶籍地址?: string | null;
      勞報簽署?: boolean;
      勞報簽名?: string | null;
      applyToProjectIds?: string[];
    } | null;

    const 專案ID = String(body?.專案ID ?? "").trim();
    if (!專案ID) {
      return NextResponse.json({ ok: false, error: "專案ID 為必填" }, { status: 400 });
    }

    const access = await getKolAccessibleProjectIds(auth.user);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
    }
    if (!access.projectIds.has(專案ID)) {
      return NextResponse.json({ ok: false, error: "無權限編輯此專案" }, { status: 403 });
    }

    const [financeList, kolInvByPid] = await Promise.all([
      getFinance(),
      getKolInvoicesByProjectIds([...access.projectIds]),
    ]);
    const financeByPid = new Map<string, (typeof financeList)[number]>();
    for (const f of financeList) {
      const pid = String(f.專案ID ?? "").trim();
      if (pid) financeByPid.set(pid, f);
    }

    const statusOf = (pid: string) => {
      const f = financeByPid.get(pid);
      const kolInv = kolInvByPid.get(pid);
      return kolFinanceProgressShort(f?.廠商付款日期, kolInv, kolInv?.KOL匯款日期);
    };

    const isLabor = body?.請款方式 === "勞務報酬";
    const targetIds = [專案ID];
    if (!isLabor) {
      const extra = Array.isArray(body?.applyToProjectIds) ? body!.applyToProjectIds! : [];
      for (const raw of extra) {
        const pid = String(raw ?? "").trim();
        if (pid && access.projectIds.has(pid) && !targetIds.includes(pid)) targetIds.push(pid);
      }
    }

    for (const pid of targetIds) {
      const f = financeByPid.get(pid);
      if (!kolClientHasCredited(f?.廠商付款日期)) {
        return NextResponse.json(
          { ok: false, error: `專案 ${pid} 客戶尚未入帳，待財務填寫客戶入帳日後方可請款` },
          { status: 400 }
        );
      }
      if (statusOf(pid) === "已匯款") {
        return NextResponse.json({ ok: false, error: `專案 ${pid} 已匯款，無法修改請款憑證` }, { status: 400 });
      }
    }

    const 填寫人 = fillerLabel(auth.user);
    const rows = [];
    for (const pid of targetIds) {
      rows.push(
        await upsertKolInvoice({
          專案ID: pid,
          請款方式: body?.請款方式,
          KOL發票號碼: body?.KOL發票號碼,
          KOL發票日期: body?.KOL發票日期,
          KOL發票備註: body?.KOL發票備註,
          勞務期間起: body?.勞務期間起,
          勞務期間迄: body?.勞務期間迄,
          勞務內容: body?.勞務內容,
          給付總額: body?.給付總額,
          身分證字號: body?.身分證字號,
          領款方式: body?.領款方式,
          聯絡電話: body?.聯絡電話,
          戶籍地址: body?.戶籍地址,
          勞報簽署: body?.勞報簽署,
          勞報簽名: body?.勞報簽名,
          填寫來源: "KOL",
          填寫人,
        })
      );
    }

    if (isLabor && body?.勞報簽署) {
      const partner = await resolveKolPartnerForUser(auth.user);
      if (partner.ok) {
        await savePartnerLaborProfile(partner.binding.partnerId, {
          身分證字號: String(body?.身分證字號 ?? "").trim(),
          聯絡電話: String(body?.聯絡電話 ?? "").trim(),
          戶籍地址: String(body?.戶籍地址 ?? "").trim(),
        });
      }
    }

    return NextResponse.json({ ok: true, updated: rows.length, invoices: rows });
  } catch (e) {
    console.error("PATCH /api/kol/invoices", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "儲存失敗" },
      { status: 400 }
    );
  }
}
