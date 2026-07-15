/**
 * GET — KOL 匯款清單（待匯款／已匯款）
 * POST — 登記 KOL 匯款（寫付款記錄 + 更新 KOL發票）
 */

import { NextRequest, NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth/api";
import { getKolRemittanceList, registerKolRemittance } from "@/lib/db/kol-remittance";

export const dynamic = "force-dynamic";

function fillerLabel(user: { name?: string | null; email?: string | null }): string {
  return String(user.name ?? "").trim() || String(user.email ?? "").trim();
}

export async function GET(request: NextRequest) {
  const auth = await requireEmployee(request);
  if (auth instanceof NextResponse) return auth;
  try {
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
  const auth = await requireEmployee(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await request.json()) as {
      專案ID?: string;
      匯款日期?: string;
      匯款金額?: string | null;
      付款對象?: string | null;
      備註?: string | null;
    } | null;

    const result = await registerKolRemittance({
      專案ID: String(body?.專案ID ?? "").trim(),
      匯款日期: String(body?.匯款日期 ?? "").trim(),
      匯款金額: body?.匯款金額,
      付款對象: body?.付款對象,
      備註: body?.備註,
      登記人: fillerLabel(auth.user),
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
