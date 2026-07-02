import { NextRequest, NextResponse } from "next/server";
import { buildPaymentFormByToken, submitPaymentDeclaration } from "@/lib/db/payment-collection";

export const dynamic = "force-dynamic";

/** GET ?token= — 公開讀取收款表單（發票明細 + 收款帳戶） */
export async function GET(request: NextRequest) {
  try {
    const token = String(request.nextUrl.searchParams.get("token") ?? "").trim();
    if (!token) {
      return NextResponse.json({ ok: false, error: "連結無效" }, { status: 400 });
    }
    const form = await buildPaymentFormByToken(token);
    if (!form) {
      return NextResponse.json({ ok: false, error: "找不到此收款連結" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, form });
  } catch (e) {
    console.error("GET /api/public/payment-form", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "讀取失敗" },
      { status: 500 }
    );
  }
}

/** POST — 匯款方提交收款申報 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      token?: string;
      匯款單位?: string;
      匯款日期?: string;
      匯款金額?: string | null;
      匯款末五碼?: string;
      匯款帳號?: string | null;
      聯絡人?: string | null;
      聯絡Email?: string | null;
      聯絡電話?: string | null;
      備註?: string | null;
    } | null;

    const token = String(body?.token ?? "").trim();
    if (!token) {
      return NextResponse.json({ ok: false, error: "連結無效" }, { status: 400 });
    }

    const submission = await submitPaymentDeclaration({
      token,
      匯款單位: body?.匯款單位 ?? "",
      匯款日期: body?.匯款日期 ?? "",
      匯款金額: body?.匯款金額,
      匯款末五碼: body?.匯款末五碼 ?? "",
      匯款帳號: body?.匯款帳號,
      聯絡人: body?.聯絡人,
      聯絡Email: body?.聯絡Email,
      聯絡電話: body?.聯絡電話,
      備註: body?.備註,
    });

    return NextResponse.json({ ok: true, submission });
  } catch (e) {
    console.error("POST /api/public/payment-form", e);
    const msg = e instanceof Error ? e.message : "提交失敗";
    const status = msg.includes("請填") || msg.includes("須為") || msg.includes("格式") ? 400 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
