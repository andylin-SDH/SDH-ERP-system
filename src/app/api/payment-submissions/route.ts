import { NextRequest, NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth/api";
import { getAllPaymentSubmissions } from "@/lib/db/payment-collection";

export const dynamic = "force-dynamic";

/** GET — 全部收款申報（匯款方填寫紀錄） */
export async function GET(request: NextRequest) {
  const auth = await requireEmployee(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const submissions = await getAllPaymentSubmissions();
    return NextResponse.json({ ok: true, submissions });
  } catch (e) {
    console.error("GET /api/payment-submissions", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "讀取失敗" },
      { status: 500 }
    );
  }
}
