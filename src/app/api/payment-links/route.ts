import { NextRequest, NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth/api";
import { getAppBaseUrl } from "@/lib/deep-link";
import {
  ensurePaymentLinkForProject,
  getPaymentLinkByProjectId,
  getSubmissionsByProjectId,
  regeneratePaymentLinkForProject,
} from "@/lib/db/payment-collection";

export const dynamic = "force-dynamic";

function buildPublicUrl(_request: NextRequest, token: string): string {
  const base = getAppBaseUrl();
  return `${base}/pay/${token}`;
}

/** GET ?專案ID= — 查詢專案收款連結與申報紀錄 */
export async function GET(request: NextRequest) {
  const auth = await requireEmployee(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const pid = String(request.nextUrl.searchParams.get("專案ID") ?? "").trim();
    if (!pid) {
      return NextResponse.json({ ok: false, error: "請提供專案ID" }, { status: 400 });
    }
    const link = await getPaymentLinkByProjectId(pid);
    const submissions = await getSubmissionsByProjectId(pid);
    return NextResponse.json({
      ok: true,
      link: link
        ? {
            ...link,
            url: buildPublicUrl(request, link.token),
          }
        : null,
      submissions,
    });
  } catch (e) {
    console.error("GET /api/payment-links", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "讀取失敗" },
      { status: 500 }
    );
  }
}

/** POST { 專案ID, regenerate?: boolean } — 產生／取得／重新產生收款連結 */
export async function POST(request: NextRequest) {
  const auth = await requireEmployee(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await request.json()) as { 專案ID?: string; regenerate?: boolean } | null;
    const pid = String(body?.專案ID ?? "").trim();
    if (!pid) {
      return NextResponse.json({ ok: false, error: "請提供專案ID" }, { status: 400 });
    }
    const creator = String(auth.user.name ?? auth.user.email ?? "").trim() || "—";
    const link = body?.regenerate
      ? await regeneratePaymentLinkForProject(pid, creator)
      : await ensurePaymentLinkForProject(pid, creator);
    return NextResponse.json({
      ok: true,
      link: {
        ...link,
        url: buildPublicUrl(request, link.token),
      },
      regenerated: Boolean(body?.regenerate),
    });
  } catch (e) {
    console.error("POST /api/payment-links", e);
    const msg = e instanceof Error ? e.message : "產生連結失敗";
    const status = msg.includes("尚無關聯發票") ? 400 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
