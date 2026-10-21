import { NextRequest, NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth/api";
import { refreshAmegoUploadStatuses } from "@/lib/db/finance";

/** 手動刷新光貿上傳狀態。只查「字軌 + 尚未完成／作廢」；平常不輪詢。 */
export async function POST(request: NextRequest) {
  const auth = await requireEmployee(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const result = await refreshAmegoUploadStatuses();
    return NextResponse.json({
      ok: true,
      checked: result.checked,
      updatedCount: result.updated.length,
      unchanged: result.unchanged,
      invoices: result.updated,
    });
  } catch (error) {
    console.error("POST /api/invoices/amego/status/refresh error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "刷新光貿狀態失敗" },
      { status: 500 }
    );
  }
}
