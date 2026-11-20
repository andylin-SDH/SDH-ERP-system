import { NextResponse } from "next/server";
import { requirePcUser } from "@/lib/production-case/access";
import { loadPcSnapshot } from "@/lib/production-case/snapshot";
import { createProgram } from "@/lib/production-case/db";

/** GET：依角色載入製作案快照 */
export async function GET(request: Request) {
  try {
    const auth = await requirePcUser(request);
    if (auth instanceof NextResponse) return auth;
    const snapshot = await loadPcSnapshot(auth.user);
    return NextResponse.json({ ok: true, snapshot });
  } catch (e) {
    console.error("GET /api/production-case", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "載入失敗" },
      { status: 500 }
    );
  }
}

/** POST：內部建立節目 */
export async function POST(request: Request) {
  try {
    const auth = await requirePcUser(request);
    if (auth instanceof NextResponse) return auth;
    if (auth.perspective !== "internal") {
      return NextResponse.json({ ok: false, error: "僅內部可建立節目" }, { status: 403 });
    }
    const body = (await request.json()) as { name?: string; client_name?: string; note?: string };
    if (!body.name?.trim()) {
      return NextResponse.json({ ok: false, error: "節目名稱必填" }, { status: 400 });
    }
    const program = await createProgram({
      name: body.name,
      client_name: body.client_name,
      note: body.note,
      pm_email: auth.user.email,
      pm_name: auth.user.name,
      actor_email: auth.user.email,
    });
    return NextResponse.json({ ok: true, program });
  } catch (e) {
    console.error("POST /api/production-case", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "建立失敗" },
      { status: 500 }
    );
  }
}
