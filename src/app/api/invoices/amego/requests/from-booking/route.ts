import { createHash, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { ingestExternalInvoiceRequest } from "@/lib/db/invoice-requests";

export const dynamic = "force-dynamic";

const APPLICANT = "錄音室預約";

function secretMatches(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function authorized(request: NextRequest): boolean {
  const secret = process.env.BOOKING_INVOICE_INGEST_SECRET?.trim();
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!provided) return false;
  return secretMatches(provided, secret);
}

function taipeiStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

function clip(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= max ? text : text.slice(0, max);
}

/**
 * 錄音室預約付款成功、且客人要開發票時寫入待審核。
 * 不向光貿開立；放行仍走既有審核。同一訂單編號只建一筆。
 */
export async function POST(request: NextRequest) {
  if (!process.env.BOOKING_INVOICE_INGEST_SECRET?.trim()) {
    return NextResponse.json({ ok: false, error: "尚未設定預約發票接入金鑰" }, { status: 503 });
  }
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      orderId?: string;
      buyerName?: string;
      buyerIdentifier?: string;
      buyerEmail?: string;
      amountTaxIncluded?: number | string;
      studioLabel?: string;
      start?: string;
      end?: string;
      guestName?: string;
      paidHours?: number | string;
      note?: string;
    };
    const orderId = String(body.orderId ?? "").trim();
    const buyerName = String(body.buyerName ?? "").trim();
    const buyerIdentifier = String(body.buyerIdentifier ?? "").trim();
    const buyerEmail = String(body.buyerEmail ?? "").trim();
    const amount = Math.round(Number(body.amountTaxIncluded));
    const studioLabel = clip(String(body.studioLabel ?? ""), 80);
    if (!/^[A-Za-z0-9]{6,40}$/.test(orderId)) {
      return NextResponse.json({ ok: false, error: "訂單編號格式不正確" }, { status: 400 });
    }
    if (!/^\d{8}$/.test(buyerIdentifier) || /^0+$/.test(buyerIdentifier)) {
      return NextResponse.json({ ok: false, error: "買受人統編須為 8 碼數字" }, { status: 400 });
    }
    if (!buyerName || /^0+$/.test(buyerName)) {
      return NextResponse.json({ ok: false, error: "請填買受人名稱" }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) {
      return NextResponse.json({ ok: false, error: "請填買受人 Email" }, { status: 400 });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ ok: false, error: "含稅金額須大於 0" }, { status: 400 });
    }

    const startLabel = taipeiStamp(String(body.start ?? ""));
    const endLabel = taipeiStamp(String(body.end ?? ""));
    const when = startLabel && endLabel ? `${startLabel}–${endLabel}` : startLabel || endLabel;
    const hours = Number(body.paidHours);
    const remark = clip(
      [
        studioLabel,
        when,
        body.guestName ? `預約人 ${String(body.guestName)}` : "",
        Number.isFinite(hours) && hours > 0 ? `${hours} 小時` : "",
        body.note ? String(body.note) : "",
        `單號 ${orderId}`,
      ]
        .filter(Boolean)
        .join(" "),
      200
    );
    const description = clip(studioLabel ? `錄音室租用 ${studioLabel}` : "錄音室租用", 256);

    const saved = await ingestExternalInvoiceRequest({
      projectId: "",
      buyerIdentifier,
      buyerName,
      buyerEmail,
      buyerAddress: "",
      remark,
      taxKind: "taxable",
      priceMode: "taxed",
      items: [{ description, quantity: 1, unitPrice: amount }],
      申請人Email: "studio-booking@sdh.local",
      申請人: APPLICANT,
      外部單號: `booking:${orderId}`,
    });

    return NextResponse.json({
      ok: true,
      alreadyExists: saved.alreadyExists,
      id: saved.request.id,
      status: saved.request.狀態,
    });
  } catch (error) {
    console.error("POST /api/invoices/amego/requests/from-booking error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "無法建立開立申請" },
      { status: 500 }
    );
  }
}
