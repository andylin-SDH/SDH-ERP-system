import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/api";
import { updateUser, verifyCredentials } from "@/modules/users";

export async function PATCH(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await request.json()) as { currentPassword?: string; newPassword?: string } | null;
    const currentPassword = String(body?.currentPassword ?? "").trim();
    const newPassword = String(body?.newPassword ?? "").trim();
    if (!currentPassword || !newPassword) {
      return NextResponse.json({ ok: false, error: "目前密碼與新密碼為必填" }, { status: 400 });
    }
    if (newPassword.length < 6) {
      return NextResponse.json({ ok: false, error: "新密碼至少需要 6 個字元" }, { status: 400 });
    }
    const okUser = await verifyCredentials(auth.user.email, currentPassword);
    if (!okUser) {
      return NextResponse.json({ ok: false, error: "目前密碼不正確" }, { status: 401 });
    }
    const updated = await updateUser(auth.user.email, { password: newPassword });
    if (!updated) {
      return NextResponse.json({ ok: false, error: "找不到目前使用者" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, message: "密碼修改成功" });
  } catch (error) {
    console.error("PATCH /api/users/password error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "修改密碼失敗" },
      { status: 500 }
    );
  }
}
