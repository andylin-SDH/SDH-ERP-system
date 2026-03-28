/** 強制動態執行 */
export const dynamic = "force-dynamic";

/**
 * 使用者可見範圍 API
 * GET ?email=xxx - 取得該使用者的可見範圍（需為董事長或管理者）
 * PUT - 儲存使用者的可見範圍（需為董事長或管理者）
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserVisibility, upsertUserVisibility } from "@/lib/db/user-visibility";
import { requireAdmin } from "@/lib/auth/api";

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(request.url);
  const email = searchParams.get("email")?.trim();
  if (!email) {
    return NextResponse.json({ ok: false, error: "請提供 email 參數" }, { status: 400 });
  }

  try {
    const visibility = await getUserVisibility(email);
    return NextResponse.json({
      ok: true,
      visibility: visibility
        ? { tables: visibility.tables, columns: visibility.columns, overview_kpis: visibility.overview_kpis }
        : { tables: [], columns: {}, overview_kpis: null },
    });
  } catch (e) {
    console.error("GET /api/user-visibility error:", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = (await request.json()) as {
      user_email?: string;
      tables?: string[];
      columns?: Record<string, string[]>;
      overview_kpis?: string[] | null;
    };
    const user_email = String(body?.user_email ?? "").trim();
    if (!user_email) {
      return NextResponse.json({ ok: false, error: "user_email 為必填" }, { status: 400 });
    }

    const visibility = await upsertUserVisibility({
      user_email,
      tables: Array.isArray(body.tables) ? body.tables : [],
      columns: body.columns && typeof body.columns === "object" ? body.columns : {},
      overview_kpis: body.overview_kpis !== undefined ? body.overview_kpis : undefined,
    });
    return NextResponse.json({
      ok: true,
      visibility: { tables: visibility.tables, columns: visibility.columns, overview_kpis: visibility.overview_kpis },
    });
  } catch (e) {
    console.error("PUT /api/user-visibility error:", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
