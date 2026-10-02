/**
 * POST：領取人對自己已可分潤的列提出或撤回提領
 * body: { ids: string[], action?: "claim" | "withdraw" }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth/api";
import { claimMyPayoutRows } from "@/lib/db/payout";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await requireEmployee(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await request.json()) as { ids?: string[]; action?: string } | null;
    const ids = Array.isArray(body?.ids) ? body.ids : [];
    const action = body?.action === "withdraw" ? "withdraw" : "claim";
    const result = await claimMyPayoutRows(ids, { name: auth.user.name ?? "", email: auth.user.email ?? "" }, action);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("POST /api/payout/claim error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
