import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth/api";
import { ScheduleTableMissingError } from "@/lib/db/schedule";
import { applySchedulePresets } from "@/lib/schedule/week";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireEmployee(request);
  if (auth instanceof NextResponse) return auth;
  const body = (await request.json().catch(() => null)) as { weekStart?: string } | null;
  try {
    const data = await applySchedulePresets(body?.weekStart ?? "", auth.user);
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (error instanceof ScheduleTableMissingError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "預排失敗";
    const status = message.includes("只有董事長") ? 403 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
