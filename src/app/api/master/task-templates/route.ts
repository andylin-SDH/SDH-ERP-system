import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/api";
import {
  createMasterTaskTemplate,
  deleteMasterTaskTemplate,
  listMasterTaskTemplates,
  updateMasterTaskTemplate,
} from "@/lib/db/master-task-templates";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const 專案ID = request.nextUrl.searchParams.get("projectId")?.trim() ?? "";
    if (!專案ID) {
      return NextResponse.json({ ok: false, error: "projectId 為必填" }, { status: 400 });
    }
    const templates = await listMasterTaskTemplates(專案ID);
    return NextResponse.json({ ok: true, templates });
  } catch (error) {
    console.error("GET /api/master/task-templates error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "查詢失敗" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await request.json()) as {
      專案ID?: string;
      任務名稱?: string;
      任務類型?: string | null;
      負責人?: string | null;
      備註?: string | null;
      每月幾號?: number;
      提前天數?: number;
      啟用?: boolean;
    } | null;
    const template = await createMasterTaskTemplate({
      專案ID: String(body?.專案ID ?? ""),
      任務名稱: String(body?.任務名稱 ?? ""),
      任務類型: body?.任務類型 ?? null,
      負責人: body?.負責人 ?? null,
      備註: body?.備註 ?? null,
      每月幾號: body?.每月幾號,
      提前天數: body?.提前天數,
      啟用: body?.啟用,
    });
    return NextResponse.json({ ok: true, template });
  } catch (error) {
    console.error("POST /api/master/task-templates error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "新增失敗" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await request.json()) as {
      id?: number;
      任務名稱?: string | null;
      任務類型?: string | null;
      負責人?: string | null;
      備註?: string | null;
      每月幾號?: number;
      提前天數?: number;
      啟用?: boolean;
    } | null;
    const id = Number(body?.id ?? 0);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ ok: false, error: "id 不合法" }, { status: 400 });
    }
    const template = await updateMasterTaskTemplate({
      id,
      任務名稱: body?.任務名稱,
      任務類型: body?.任務類型,
      負責人: body?.負責人,
      備註: body?.備註,
      每月幾號: body?.每月幾號,
      提前天數: body?.提前天數,
      啟用: body?.啟用,
    });
    return NextResponse.json({ ok: true, template });
  } catch (error) {
    console.error("PATCH /api/master/task-templates error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "更新失敗" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await request.json()) as { id?: number } | null;
    const id = Number(body?.id ?? 0);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ ok: false, error: "id 不合法" }, { status: 400 });
    }
    await deleteMasterTaskTemplate(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/master/task-templates error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "刪除失敗" },
      { status: 500 }
    );
  }
}
