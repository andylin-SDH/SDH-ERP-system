/**
 * PATCH：KOL 填寫／更新請款發票（限本人專案；已分潤不可改）
 * body: { 專案ID, KOL發票號碼?, KOL發票日期?, KOL發票備註?, applyToProjectIds?: string[] }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireKol } from "@/lib/auth/api";
import { upsertKolInvoice } from "@/lib/db/kol-invoices";
import { getKolAccessibleProjectIds } from "@/lib/kol/partner-bind";
import { getFinance } from "@/modules/finance";
import { kolFinanceProgressShort } from "@/lib/kol/finance-status";

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
      KOL發票號碼?: string | null;
      KOL發票日期?: string | null;
      KOL發票備註?: string | null;
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

    const financeByPid = new Map<string, string>();
    for (const f of await getFinance()) {
      const pid = String(f.專案ID ?? "").trim();
      if (pid) financeByPid.set(pid, kolFinanceProgressShort(f.廠商付款日期, f.員工分潤日期));
    }

    const targetIds = [專案ID];
    const extra = Array.isArray(body?.applyToProjectIds) ? body!.applyToProjectIds! : [];
    for (const raw of extra) {
      const pid = String(raw ?? "").trim();
      if (pid && access.projectIds.has(pid) && !targetIds.includes(pid)) targetIds.push(pid);
    }

    for (const pid of targetIds) {
      if (financeByPid.get(pid) === "已分潤") {
        return NextResponse.json({ ok: false, error: `專案 ${pid} 已分潤，無法修改 KOL 發票` }, { status: 400 });
      }
    }

    const 填寫人 = fillerLabel(auth.user);
    const rows = [];
    for (const pid of targetIds) {
      rows.push(
        await upsertKolInvoice({
          專案ID: pid,
          KOL發票號碼: body?.KOL發票號碼,
          KOL發票日期: body?.KOL發票日期,
          KOL發票備註: body?.KOL發票備註,
          填寫來源: "KOL",
          填寫人,
        })
      );
    }

    return NextResponse.json({ ok: true, updated: rows.length, invoices: rows });
  } catch (e) {
    console.error("PATCH /api/kol/invoices", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "儲存失敗" },
      { status: 500 }
    );
  }
}
