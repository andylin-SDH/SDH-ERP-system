/**
 * GET ?專案ID= — 單筆勞報收據
 * GET ?專案IDs=a,b,c — 多筆（批次下載用）
 * POST — 注記已下載 { 專案ID } 或 { 專案IDs: string[] }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth/api";
import { getLaborReceiptExportByProjectId } from "@/lib/db/kol-labor-receipts";
import { markKolLaborReceiptDownloaded } from "@/lib/db/kol-invoices";

export const dynamic = "force-dynamic";

function parseProjectIds(raw: string): string[] {
  return [...new Set(String(raw ?? "").split(",").map((s) => s.trim()).filter(Boolean))];
}

export async function GET(request: NextRequest) {
  const auth = await requireEmployee(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const sp = new URL(request.url).searchParams;
    const multi = String(sp.get("專案IDs") ?? "").trim();
    if (multi) {
      const ids = parseProjectIds(multi);
      if (ids.length === 0) {
        return NextResponse.json({ ok: false, error: "專案IDs 為必填" }, { status: 400 });
      }
      const receipts = [];
      const errors: Array<{ 專案ID: string; error: string }> = [];
      for (const pid of ids) {
        try {
          receipts.push(await getLaborReceiptExportByProjectId(pid));
        } catch (e) {
          errors.push({ 專案ID: pid, error: e instanceof Error ? e.message : "讀取失敗" });
        }
      }
      return NextResponse.json({ ok: true, receipts, errors });
    }

    const pid = String(sp.get("專案ID") ?? "").trim();
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

export async function POST(request: NextRequest) {
  const auth = await requireEmployee(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await request.json()) as { 專案ID?: string; 專案IDs?: string[] } | null;
    const ids = [
      ...new Set([
        ...(Array.isArray(body?.專案IDs) ? body!.專案IDs! : []),
        String(body?.專案ID ?? "").trim(),
      ]
        .map((p) => String(p ?? "").trim())
        .filter(Boolean)),
    ];
    if (ids.length === 0) {
      return NextResponse.json({ ok: false, error: "專案ID 為必填" }, { status: 400 });
    }
    const result = await markKolLaborReceiptDownloaded(ids);
    return NextResponse.json({
      ok: true,
      marked: result.ok,
      failed: result.failed,
    });
  } catch (e) {
    console.error("POST /api/kol-labor-receipts", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "注記失敗" },
      { status: 400 }
    );
  }
}
