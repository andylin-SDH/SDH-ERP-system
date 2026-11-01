import { NextRequest, NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth/api";
import { invoiceEInvoiceNotLiveResponse, isInvoiceEInvoiceLive } from "@/lib/invoice/launch";
import { getSupabase } from "@/lib/supabase/server";

/** 開立頁選專案用。只讀名稱、廠商、統編、收件信箱、未稅金額，進頁讀一次，搜尋在瀏覽器裡做。 */
export async function GET(request: NextRequest) {
  const auth = await requireEmployee(request);
  if (auth instanceof NextResponse) return auth;
  if (!isInvoiceEInvoiceLive()) return invoiceEInvoiceNotLiveResponse();
  try {
    const supabase = getSupabase();
    const columnSets = [
      '"專案ID","專案名稱","廠商名稱","統一編號","收件人Email","發票品名","專案總金額未稅","KOL名稱"',
      '"專案ID","專案名稱","廠商名稱","統一編號","專案總金額未稅","KOL名稱"',
      '"專案ID","專案名稱","廠商名稱","專案總金額未稅","KOL名稱"',
    ];

    let rows: unknown[] | null = null;
    let lastError: { message?: string } | null = null;
    for (const columns of columnSets) {
      const withSoft = await supabase
        .from("大總表")
        .select(columns)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (!withSoft.error) {
        rows = withSoft.data;
        lastError = null;
        break;
      }
      lastError = withSoft.error;
      if (!/收件人Email|統一編號|發票品名|deleted_at|schema cache|column/i.test(withSoft.error.message ?? "")) {
        throw withSoft.error;
      }
      const fallback = await supabase.from("大總表").select(columns).order("created_at", { ascending: false });
      if (!fallback.error) {
        rows = fallback.data;
        lastError = null;
        break;
      }
      lastError = fallback.error;
      if (!/收件人Email|統一編號|發票品名|deleted_at|schema cache|column/i.test(fallback.error.message ?? "")) {
        throw fallback.error;
      }
    }
    if (lastError) throw lastError;

    const projects = (rows ?? [])
      .map((row) => {
        const r = row as Record<string, unknown>;
        return {
          id: String(r.專案ID ?? "").trim(),
          name: String(r.專案名稱 ?? "").trim(),
          vendor: String(r.廠商名稱 ?? "").trim(),
          taxId: String(r.統一編號 ?? "").trim(),
          email: String(r.收件人Email ?? "").trim(),
          itemName: String(r.發票品名 ?? "").trim(),
          untaxed: String(r.專案總金額未稅 ?? "").trim(),
          kol: String(r.KOL名稱 ?? "").trim(),
        };
      })
      .filter((row) => row.id);
    return NextResponse.json({ ok: true, projects });
  } catch (error) {
    console.error("GET /api/invoices/amego/projects error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "無法讀取專案" },
      { status: 500 }
    );
  }
}
