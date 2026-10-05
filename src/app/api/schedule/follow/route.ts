import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth/api";
import {
  deleteFollowShow,
  FollowTableMissingError,
  insertFollowShow,
  listFollowShowRecords,
  updateFollowShow,
} from "@/lib/db/follow-shows";
import { SCHEDULE_CONFIG } from "@/lib/schedule/config.server";
import { schedulePersonOf } from "@/lib/schedule/identity";
import { invalidateScheduleCalendarCache } from "@/lib/schedule/week";

export const dynamic = "force-dynamic";

const PEOPLE = SCHEDULE_CONFIG.PEOPLE.map((person) => person.name);

function canEditFollow(user: { name?: string | null; email?: string | null; role?: string | null }): boolean {
  return String(user.role ?? "") === "董事長" || schedulePersonOf(user) === "維尼";
}

function splitList(value: string): string[] {
  return value
    .split(/[,，、\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function readFields(body: { show?: string; keywords?: string; companions?: string[] | string }) {
  const show = String(body.show ?? "").trim();
  if (!show) throw new Error("請填節目名稱");
  if (show.length > 80) throw new Error("節目名稱太長");
  let keywords = splitList(String(body.keywords ?? ""));
  if (!keywords.length) keywords = [show];
  if (keywords.some((keyword) => keyword.length < 2)) throw new Error("每個關鍵字至少 2 個字");
  const companions = Array.isArray(body.companions)
    ? body.companions.map((name) => String(name).trim()).filter(Boolean)
    : splitList(String(body.companions ?? ""));
  if (companions.some((name) => !PEOPLE.includes(name))) throw new Error("一起跟錄的人要是班表上的人");
  return { show, keywords, companions };
}

function toPublic(rows: { id: number; show: string; keywords: string[]; usuallyWith?: string[] }[]) {
  return rows.map((row) => ({
    id: row.id,
    show: row.show,
    keywords: row.keywords,
    companions: row.usuallyWith ?? [],
  }));
}

export async function GET(request: Request) {
  const auth = await requireEmployee(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const rows = await listFollowShowRecords();
    return NextResponse.json({ ok: true, shows: toPublic(rows), canEdit: canEditFollow(auth.user) });
  } catch (error) {
    if (error instanceof FollowTableMissingError) {
      return NextResponse.json({ ok: false, error: error.message, shows: [], canEdit: canEditFollow(auth.user) }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "讀取跟錄名單失敗" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireEmployee(request);
  if (auth instanceof NextResponse) return auth;
  if (!canEditFollow(auth.user)) {
    return NextResponse.json({ ok: false, error: "只有董事長和維尼可以改跟錄名單" }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as { show?: string; keywords?: string; companions?: string[] } | null;
  if (!body) return NextResponse.json({ ok: false, error: "缺少內容" }, { status: 400 });
  try {
    const fields = readFields(body);
    await insertFollowShow(fields.show, fields.keywords, fields.companions);
    invalidateScheduleCalendarCache();
    const rows = await listFollowShowRecords();
    return NextResponse.json({ ok: true, shows: toPublic(rows) });
  } catch (error) {
    return writeError(error);
  }
}

export async function PATCH(request: Request) {
  const auth = await requireEmployee(request);
  if (auth instanceof NextResponse) return auth;
  if (!canEditFollow(auth.user)) {
    return NextResponse.json({ ok: false, error: "只有董事長和維尼可以改跟錄名單" }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as { id?: number; show?: string; keywords?: string; companions?: string[] } | null;
  if (!body?.id) return NextResponse.json({ ok: false, error: "缺少節目" }, { status: 400 });
  try {
    const fields = readFields(body);
    await updateFollowShow(Number(body.id), fields.show, fields.keywords, fields.companions);
    invalidateScheduleCalendarCache();
    const rows = await listFollowShowRecords();
    return NextResponse.json({ ok: true, shows: toPublic(rows) });
  } catch (error) {
    return writeError(error);
  }
}

export async function DELETE(request: Request) {
  const auth = await requireEmployee(request);
  if (auth instanceof NextResponse) return auth;
  if (!canEditFollow(auth.user)) {
    return NextResponse.json({ ok: false, error: "只有董事長和維尼可以改跟錄名單" }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as { id?: number } | null;
  if (!body?.id) return NextResponse.json({ ok: false, error: "缺少節目" }, { status: 400 });
  try {
    await deleteFollowShow(Number(body.id));
    invalidateScheduleCalendarCache();
    const rows = await listFollowShowRecords();
    return NextResponse.json({ ok: true, shows: toPublic(rows) });
  } catch (error) {
    return writeError(error);
  }
}

function writeError(error: unknown) {
  if (error instanceof FollowTableMissingError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 503 });
  }
  return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "儲存失敗" }, { status: 400 });
}
