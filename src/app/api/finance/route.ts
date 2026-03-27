import { NextRequest, NextResponse } from "next/server";
import { getFinance } from "@/modules/finance";
import { requireAuth } from "@/lib/auth/api";
import { syncAllFinanceFromMaster } from "@/lib/db/finance";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  try {
    await syncAllFinanceFromMaster();
    const finance = await getFinance();
    return NextResponse.json({ ok: true, finance });
  } catch (error) {
    console.error("GET /api/finance error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
