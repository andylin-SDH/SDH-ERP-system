/**
 * 使用者 API
 * GET /api/users - 使用者列表（需登入，供分潤/專案人員下拉選單）
 * POST /api/users - 新增使用者（限董事長/管理者）
 */

import { NextRequest, NextResponse } from "next/server";
import { getUsers, createUser, updateUser } from "@/modules/users";
import type { CreateUserInput, UpdateUserInput } from "@/lib/db/users";
import { requireAdmin, requireEmployee } from "@/lib/auth/api";

export async function GET(request: NextRequest) {
  const auth = await requireEmployee(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const users = await getUsers();
    return NextResponse.json({ ok: true, users });
  } catch (error) {
    console.error("GET /api/users error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await request.json()) as Partial<CreateUserInput> | null;
    const userEmail = String(body?.email ?? "").trim().toLowerCase();
    const name = String(body?.name ?? "").trim();
    const password = String(body?.password ?? "").trim();
    const role = String(body?.role ?? "").trim();
    if (!userEmail || !name || !password || !role) {
      return NextResponse.json({ ok: false, error: "帳號、姓名、密碼、角色為必填" }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail)) {
      return NextResponse.json({ ok: false, error: "帳號必須為有效的 Email 格式（供發信通知使用）" }, { status: 400 });
    }

    const user = await createUser({
      email: userEmail,
      name,
      password,
      role,
      dept: body?.dept?.trim() || undefined,
      scope: body?.scope?.trim() || undefined,
    });
    return NextResponse.json({ ok: true, user });
  } catch (error) {
    console.error("POST /api/users error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "新增失敗" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await request.json()) as { email?: string } & Partial<UpdateUserInput>;
    const email = String(body?.email ?? "").trim().toLowerCase();
    if (!email) {
      return NextResponse.json({ ok: false, error: "email 為必填" }, { status: 400 });
    }
    const payload: UpdateUserInput = {};
    if (body?.name !== undefined) payload.name = String(body.name).trim();
    if (body?.role !== undefined) payload.role = String(body.role).trim();
    if (body?.dept !== undefined) payload.dept = String(body.dept ?? "").trim() || undefined;
    if (body?.scope !== undefined) payload.scope = String(body.scope ?? "").trim() || undefined;
    if (body?.password !== undefined && String(body.password).trim()) payload.password = String(body.password).trim();
    if (Object.keys(payload).length === 0) {
      return NextResponse.json({ ok: false, error: "請提供要更新的欄位" }, { status: 400 });
    }
    const user = await updateUser(email, payload);
    if (!user) {
      return NextResponse.json({ ok: false, error: "找不到該使用者" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, user });
  } catch (error) {
    console.error("PATCH /api/users error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "更新失敗" },
      { status: 500 }
    );
  }
}
