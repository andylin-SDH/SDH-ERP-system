/**
 * GET ?專案ID= — 讀取 KOL 請款發票
 * PATCH — 內部代填（限員工後台）
 */

import { NextRequest, NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth/api";
import { getKolInvoiceByProjectId, upsertKolInvoice } from "@/lib/db/kol-invoices";

export const dynamic = "force-dynamic";

function fillerLabel(user: { name?: string | null; email?: string | null }): string {
  return String(user.name ?? "").trim() || String(user.email ?? "").trim();
}

export async function GET(request: NextRequest) {
  const auth = await requireEmployee(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const pid = String(new URL(request.url).searchParams.get("專案ID") ?? "").trim();
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

    const 填寫人 = fillerLabel(auth.user);
    const rows = [];
    for (const pid of targetIds) {
      rows.push(
        await upsertKolInvoice({
          專案ID: pid,
          KOL發票號碼: body?.KOL發票號碼,
          KOL發票日期: body?.KOL發票日期,
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
