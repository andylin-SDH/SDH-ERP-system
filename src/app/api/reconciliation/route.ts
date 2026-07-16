import { NextRequest, NextResponse } from "next/server";
import { requireFinanceOperator } from "@/lib/auth/api";
import {
  confirmReconciliationMatch,
  getReconciliationDashboard,
  rejectReconciliationMatch,
  runReconciliationMatching,
  setBankTransactionIgnored,
} from "@/lib/db/reconciliation";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireFinanceOperator(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const dashboard = await getReconciliationDashboard();
    return NextResponse.json({ ok: true, ...dashboard });
  } catch (error) {
    console.error("GET /api/reconciliation", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "讀取對帳資料失敗" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFinanceOperator(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await request.json()) as {
      action?: "runMatching" | "confirm" | "reject" | "ignore" | "reopen";
      matchId?: string;
      transactionId?: string;
    };
    if (body.action === "runMatching") {
      const result = await runReconciliationMatching();
      return NextResponse.json({ ok: true, ...result });
    }
    if (body.action === "confirm") {
      const matchId = String(body.matchId ?? "").trim();
      if (!matchId) return NextResponse.json({ ok: false, error: "缺少對帳候選 ID" }, { status: 400 });
      await confirmReconciliationMatch(matchId, auth.user.email);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "reject") {
      const matchId = String(body.matchId ?? "").trim();
      if (!matchId) return NextResponse.json({ ok: false, error: "缺少對帳候選 ID" }, { status: 400 });
      await rejectReconciliationMatch(matchId);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "ignore" || body.action === "reopen") {
      const transactionId = String(body.transactionId ?? "").trim();
      if (!transactionId) return NextResponse.json({ ok: false, error: "缺少銀行交易 ID" }, { status: 400 });
      await setBankTransactionIgnored(transactionId, body.action === "ignore");
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ ok: false, error: "不支援的操作" }, { status: 400 });
  } catch (error) {
    console.error("POST /api/reconciliation", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "對帳操作失敗" },
      { status: 500 }
    );
  }
}

