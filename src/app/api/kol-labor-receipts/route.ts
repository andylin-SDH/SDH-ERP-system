/**
 * GET ?專案ID= — 員工後台讀取可列印勞報收據資料
 */

import { NextRequest, NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth/api";
import { getLaborReceiptExportByProjectId } from "@/lib/db/kol-labor-receipts";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireEmployee(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const pid = String(new URL(request.url).searchParams.get("專案ID") ?? "").trim();
    if (!pid) {
      return NextResponse.json({ ok: false, error: "專案ID 為必填" }, { status: 400 });
    }
    const receipt = await getLaborReceiptExportByProjectId(pid);
    return NextResponse.json({ ok: true, receipt });
  } catch (e) {
    console.error("GET /api/kol-labor-receipts", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "讀取失敗" },
      { status: 400 }
    );
  }
}
