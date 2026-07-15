import { NextResponse } from "next/server";
import { getPartnersWithError } from "@/lib/db/partners";
import { buildKolCatalogItems } from "@/lib/kol/catalog";

export const dynamic = "force-dynamic";

/** GET — 公開 KOL 名單（僅提案用欄位，不含聯絡／分潤） */
export async function GET() {
  try {
    const { partners, error } = await getPartnersWithError();
    const items = buildKolCatalogItems(partners);
    return NextResponse.json({
      ok: true,
      count: items.length,
      items,
      generatedAt: new Date().toISOString(),
      ...(error ? { warning: error } : {}),
    });
  } catch (e) {
    console.error("GET /api/public/kol-catalog", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "讀取失敗" },
      { status: 500 }
    );
  }
}
