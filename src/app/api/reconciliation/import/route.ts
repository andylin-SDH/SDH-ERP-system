import { NextRequest, NextResponse } from "next/server";
import { requireFinanceOperator } from "@/lib/auth/api";
import { importBankTransactions, runReconciliationMatching } from "@/lib/db/reconciliation";
import type { BankImportRow } from "@/lib/reconciliation/types";

export async function POST(request: NextRequest) {
  const auth = await requireFinanceOperator(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await request.json()) as {
      filename?: string;
      rows?: BankImportRow[];
    };
    if (!Array.isArray(body.rows) || body.rows.length === 0) {
      return NextResponse.json({ ok: false, error: "檔案內沒有可匯入的交易" }, { status: 400 });
    }
    if (body.rows.length > 5000) {
      return NextResponse.json({ ok: false, error: "單次最多匯入 5,000 筆交易" }, { status: 400 });
    }
    const creditRows = body.rows.filter((row) => row?.direction !== "debit");
    if (creditRows.length === 0) {
      return NextResponse.json({ ok: false, error: "檔案內沒有可匯入的入帳交易" }, { status: 400 });
    }
    const imported = await importBankTransactions(creditRows, {
      filename: body.filename,
      importedBy: auth.user.email,
      source: "cathay_csv",
    });
    const matching = await runReconciliationMatching();
    return NextResponse.json({
      ok: true,
      ...imported,
      skippedDebits: body.rows.length - creditRows.length,
      matching,
    });
  } catch (error) {
    console.error("POST /api/reconciliation/import", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "匯入銀行交易失敗" },
      { status: 500 }
    );
  }
}
