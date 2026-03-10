import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/api";
import { refreshFollowersForPartners } from "@/lib/fetch-followers";

/** 手動觸發：僅管理者。單次最多處理 20 位合作夥伴，避免逾時。 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  const limit = 20;
  try {
    const result = await refreshFollowersForPartners(limit);
    return NextResponse.json({
      ok: true,
      updated: result.updated,
      errors: result.errors,
      message: `已更新 ${result.updated} 位合作夥伴粉絲數${result.errors.length ? `，${result.errors.length} 筆失敗` : ""}`,
    });
  } catch (error) {
    console.error("POST /api/partners/refresh-followers error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "更新粉絲數失敗",
      },
      { status: 500 }
    );
  }
}
