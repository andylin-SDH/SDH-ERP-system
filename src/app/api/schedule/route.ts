import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth/api";
import { ScheduleTableMissingError } from "@/lib/db/schedule";
import { buildScheduleWeek, changeScheduleClaims } from "@/lib/schedule/week";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireEmployee(request);
  if (auth instanceof NextResponse) return auth;
  const week = new URL(request.url).searchParams.get("week");
  const force = new URL(request.url).searchParams.get("force") === "1";
  try {
    const data = await buildScheduleWeek(week, auth.user, force);
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (error instanceof ScheduleTableMissingError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "讀取班表失敗" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireEmployee(request);
  if (auth instanceof NextResponse) return auth;
  const body = (await request.json().catch(() => null)) as {
    weekStart?: string;
    person?: string;
    on?: boolean;
    items?: { date: string; slot: string; place: string }[];
  } | null;
  if (!body?.person || !Array.isArray(body.items)) {
    return NextResponse.json({ ok: false, error: "缺少班次" }, { status: 400 });
  }
  try {
    const data = await changeScheduleClaims(body.weekStart ?? "", body.person, body.items, !!body.on, auth.user);
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (error instanceof ScheduleTableMissingError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "寫入班表失敗";
    const status = message.includes("只能改自己的班") ? 403 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
