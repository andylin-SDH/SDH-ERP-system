/**
 * POST：管理員重設使用者登入密碼（限董事長/管理者，不需舊密碼）
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/api";
import { getUserByEmail, updateUserPassword } from "@/modules/users";

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await request.json()) as { email?: string; newPassword?: string } | null;
    const email = String(body?.email ?? "").trim().toLowerCase();
    const newPassword = String(body?.newPassword ?? "").trim();
    if (!email) {
      return NextResponse.json({ ok: false, error: "email 為必填" }, { status: 400 });
    }
    if (!newPassword) {
      return NextResponse.json({ ok: false, error: "新密碼為必填" }, { status: 400 });
    }
    if (newPassword.length < 6) {
      return NextResponse.json({ ok: false, error: "新密碼至少需要 6 個字元" }, { status: 400 });
    }

    const existing = await getUserByEmail(email);
    if (!existing) {
      return NextResponse.json({ ok: false, error: "找不到該使用者" }, { status: 404 });
    }

    const updated = await updateUserPassword(email, newPassword);
    if (!updated) {
      return NextResponse.json(
        {
          ok: false,
          error: "密碼重設失敗：寫入或驗證未通過，請稍後再試或聯絡技術人員。",
        },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true, message: "密碼已重設", user: updated });
  } catch (error) {
    console.error("POST /api/users/reset-password error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "重設失敗" },
      { status: 500 }
    );
  }
}
