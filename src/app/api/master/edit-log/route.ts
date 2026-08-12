import { NextRequest, NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth/api";
import { listMasterEditLogs } from "@/lib/db/master-edit-log";

export async function GET(request: NextRequest) {
  const auth = await requireEmployee(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const { searchParams } = new URL(request.url);
    const 專案ID = String(searchParams.get("專案ID") ?? "").trim();
    if (!專案ID) {
      return NextResponse.json({ ok: false, error: "專案ID 為必填" }, { status: 400 });
    }
    const logs = await listMasterEditLogs(專案ID);
    return NextResponse.json({ ok: true, logs });
  } catch (error) {
    console.error("GET /api/master/edit-log error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "讀取失敗" },
      { status: 500 }
    );
  }
}
