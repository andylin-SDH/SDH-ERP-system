import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/api";
import { listPartnerEditLogs } from "@/lib/db/partner-edit-log";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const { searchParams } = new URL(request.url);
    const PartnerID = String(searchParams.get("PartnerID") ?? "").trim();
    if (!PartnerID) {
      return NextResponse.json({ ok: false, error: "PartnerID 為必填" }, { status: 400 });
    }
    const logs = await listPartnerEditLogs(PartnerID);
    return NextResponse.json({ ok: true, logs });
  } catch (error) {
    console.error("GET /api/partners/edit-log error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "讀取失敗" },
      { status: 500 }
    );
  }
}
