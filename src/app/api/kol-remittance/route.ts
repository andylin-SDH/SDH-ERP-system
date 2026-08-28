/**
 * GET — KOL 匯款清單（待匯款／已匯款）；?candidates=advance 代墊候選
 * POST — 登記 KOL 匯款（單筆或批次；寫付款記錄 + 更新 KOL發票）
 *        body.代墊=true 時僅董事長／會計，允許廠商未入帳
 */

import { NextRequest, NextResponse } from "next/server";
import {
  canRegisterKolAdvanceRemittance,
  requireEmployee,
  requireKolAdvanceRemittanceEditor,
} from "@/lib/auth/api";
import {
  getKolAdvanceRemittanceCandidates,
  getKolRemittanceList,
  registerKolRemittance,
  registerKolRemittanceBatch,
} from "@/lib/db/kol-remittance";

export const dynamic = "force-dynamic";

function fillerLabel(user: { name?: string | null; email?: string | null }): string {
  return String(user.name ?? "").trim() || String(user.email ?? "").trim();
}

export async function GET(request: NextRequest) {
  const auth = await requireEmployee(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const candidates = String(request.nextUrl.searchParams.get("candidates") ?? "").trim();
    if (candidates === "advance") {
      if (!canRegisterKolAdvanceRemittance(auth.user.role)) {
        return NextResponse.json({ ok: false, error: "僅董事長或會計可查看代墊候選" }, { status: 403 });
      }
      const items = await getKolAdvanceRemittanceCandidates();
      return NextResponse.json({ ok: true, items });
    }
    const items = await getKolRemittanceList();
    return NextResponse.json({ ok: true, items });
  } catch (e) {
    console.error("GET /api/kol-remittance", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "讀取失敗" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      專案ID?: string;
      匯款日期?: string;
      匯款金額?: string | null;
      付款對象?: string | null;
      備註?: string | null;
      代墊?: boolean;
      items?: Array<{
        專案ID?: string;
        匯款日期?: string;
        匯款金額?: string | null;
        付款對象?: string | null;
        備註?: string | null;
      }>;
    } | null;

    const isAdvance = Boolean(body?.代墊);
    const auth = isAdvance
      ? await requireKolAdvanceRemittanceEditor(request)
      : await requireEmployee(request);
    if (auth instanceof NextResponse) return auth;

    const 登記人 = fillerLabel(auth.user);
    const rawItems = Array.isArray(body?.items) ? body!.items! : null;

    if (rawItems && rawItems.length > 0) {
      if (isAdvance) {
        return NextResponse.json(
          { ok: false, error: "批次登記不支援代墊，請逐筆使用代墊匯款" },
          { status: 400 }
        );
      }
      const items = rawItems.map((it) => ({
        專案ID: String(it?.專案ID ?? "").trim(),
        匯款日期: String(it?.匯款日期 ?? body?.匯款日期 ?? "").trim(),
        匯款金額: it?.匯款金額,
        付款對象: it?.付款對象,
        備註: it?.備註,
        登記人,
      }));
      const result = await registerKolRemittanceBatch(items);
      return NextResponse.json({
        ok: true,
        updated: result.ok.length,
        okProjectIds: result.ok,
        failed: result.failed,
      });
    }

    const result = await registerKolRemittance({
      專案ID: String(body?.專案ID ?? "").trim(),
      匯款日期: String(body?.匯款日期 ?? "").trim(),
      匯款金額: body?.匯款金額,
      付款對象: body?.付款對象,
      備註: body?.備註,
      登記人,
      代墊: isAdvance,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("POST /api/kol-remittance", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "登記失敗" },
      { status: 400 }
    );
  }
}
