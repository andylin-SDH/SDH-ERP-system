/**
 * GET ?專案ID= — 讀取 KOL 請款發票
 * PATCH — 內部代填（限員工後台）
 */

import { NextRequest, NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth/api";
import { getKolInvoiceByProjectId, getKolInvoicesByProjectIds, revokeKolClaimCredential, upsertKolInvoice } from "@/lib/db/kol-invoices";
import { getFinance } from "@/modules/finance";
import { kolFinanceProgressShort } from "@/lib/kol/finance-status";

export const dynamic = "force-dynamic";

function fillerLabel(user: { name?: string | null; email?: string | null }): string {
  return String(user.name ?? "").trim() || String(user.email ?? "").trim();
}

export async function GET(request: NextRequest) {
  const auth = await requireEmployee(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const sp = new URL(request.url).searchParams;
    const multi = String(sp.get("專案IDs") ?? "").trim();
    if (multi) {
      const ids = [...new Set(multi.split(",").map((s) => s.trim()).filter(Boolean))];
      const map = await getKolInvoicesByProjectIds(ids);
      const invoices = ids.map((專案ID) => ({
        專案ID,
        invoice: map.get(專案ID) ?? null,
      }));
      return NextResponse.json({ ok: true, invoices });
    }
    const pid = String(sp.get("專案ID") ?? "").trim();
    if (!pid) {
      return NextResponse.json({ ok: false, error: "專案ID 為必填" }, { status: 400 });
    }
    const invoice = await getKolInvoiceByProjectId(pid);
    return NextResponse.json({ ok: true, invoice });
  } catch (e) {
    console.error("GET /api/kol-invoices", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "讀取失敗" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireEmployee(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await request.json()) as {
      專案ID?: string;
      KOL發票號碼?: string | null;
      KOL發票日期?: string | null;
      KOL發票金額?: string | null;
      KOL發票備註?: string | null;
      applyToProjectIds?: string[];
    } | null;

    const 專案ID = String(body?.專案ID ?? "").trim();
    if (!專案ID) {
      return NextResponse.json({ ok: false, error: "專案ID 為必填" }, { status: 400 });
    }

    const targetIds = [專案ID];
    const extra = Array.isArray(body?.applyToProjectIds) ? body!.applyToProjectIds! : [];
    for (const raw of extra) {
      const pid = String(raw ?? "").trim();
      if (pid && !targetIds.includes(pid)) targetIds.push(pid);
    }

    const [financeList, kolInvByPid] = await Promise.all([getFinance(), getKolInvoicesByProjectIds(targetIds)]);
    const financeByPid = new Map<string, (typeof financeList)[number]>();
    for (const f of financeList) {
      const pid = String(f.專案ID ?? "").trim();
      if (pid) financeByPid.set(pid, f);
    }

    /** 主專案必寫；其他僅套用「尚未填發票號碼」者，避免覆蓋已填資料 */
    const writeIds = targetIds.filter((pid) => {
      if (pid === 專案ID) return true;
      const existing = String(kolInvByPid.get(pid)?.KOL發票號碼 ?? "").trim();
      return !existing;
    });

    for (const pid of writeIds) {
      const f = financeByPid.get(pid);
      const kolInv = kolInvByPid.get(pid);
      const status = kolFinanceProgressShort(f?.廠商付款日期, kolInv, kolInv?.KOL匯款日期);
      if (status === "已匯款") {
        return NextResponse.json({ ok: false, error: `專案 ${pid} 已匯款，無法修改請款憑證` }, { status: 400 });
      }
    }

    const 填寫人 = fillerLabel(auth.user);
    const rows = [];
    for (const pid of writeIds) {
      rows.push(
        await upsertKolInvoice({
          專案ID: pid,
          KOL發票號碼: body?.KOL發票號碼,
          KOL發票日期: body?.KOL發票日期,
          KOL發票金額: body?.KOL發票金額,
          KOL發票備註: body?.KOL發票備註,
          填寫來源: "內部",
          填寫人,
        })
      );
    }

    return NextResponse.json({ ok: true, updated: rows.length, invoices: rows });
  } catch (e) {
    console.error("PATCH /api/kol-invoices", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "儲存失敗" },
      { status: 500 }
    );
  }
}

/** DELETE：內部撤回待匯款請款憑證（回到可請款） */
export async function DELETE(request: NextRequest) {
  const auth = await requireEmployee(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await request.json()) as { 專案ID?: string } | null;
    const 專案ID = String(body?.專案ID ?? "").trim();
    if (!專案ID) {
      return NextResponse.json({ ok: false, error: "專案ID 為必填" }, { status: 400 });
    }

    const [financeList, kolInvByPid] = await Promise.all([
      getFinance(),
      getKolInvoicesByProjectIds([專案ID]),
    ]);
    const f = financeList.find((x) => String(x.專案ID ?? "").trim() === 專案ID);
    const kolInv = kolInvByPid.get(專案ID);
    const status = kolFinanceProgressShort(f?.廠商付款日期, kolInv, kolInv?.KOL匯款日期);
    if (status === "已匯款") {
      return NextResponse.json({ ok: false, error: "已匯款不可撤回請款憑證" }, { status: 400 });
    }
    if (status !== "待匯款") {
      return NextResponse.json({ ok: false, error: "僅待匯款狀態可撤回請款憑證" }, { status: 400 });
    }

    const result = await revokeKolClaimCredential({
      專案ID,
      填寫人: fillerLabel(auth.user),
      填寫來源: "內部",
    });

    return NextResponse.json({
      ok: true,
      cleared: result.clearedProjectIds.length,
      clearedProjectIds: result.clearedProjectIds,
      batchId: result.batchId,
    });
  } catch (e) {
    console.error("DELETE /api/kol-invoices", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "撤回失敗" },
      { status: 500 }
    );
  }
}
