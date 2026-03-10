/**
 * 測試 Google Sheets 連線
 * GET /api/sheets/test
 */

import { NextRequest, NextResponse } from "next/server";
import { readSheet, getSpreadsheetId } from "@/lib/sheets";
import { SHEET_NAMES } from "@/lib/sheets";
import { requireAuth } from "@/lib/auth/api";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const spreadsheetId = getSpreadsheetId();
    const users = await readSheet(SHEET_NAMES.USERS, "A1:E5");
    return NextResponse.json({
      ok: true,
      spreadsheetId,
      sheet: SHEET_NAMES.USERS,
      rows: users.length,
      data: users,
    });
  } catch (error) {
    console.error("Sheets test error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
