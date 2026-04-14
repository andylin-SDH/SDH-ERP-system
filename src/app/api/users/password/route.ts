import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/api";
import { updateUserPassword, verifyCredentials } from "@/modules/users";

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
    const updated = await updateUserPassword(auth.user.email, newPassword);
    if (!updated) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "密碼更新失敗：寫入或驗證未通過。若已重試仍失敗，請管理員檢查 Supabase users 表的 RLS 是否允許更新 password／密碼欄位。",
        },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true, message: "密碼修改成功" });
  } catch (error) {
    console.error("PATCH /api/users/password error:", error);
    const msg =
      error instanceof Error
        ? error.message
        : typeof error === "object" && error !== null && "message" in error
          ? String((error as { message?: unknown }).message)
          : String(error);
    return NextResponse.json(
      { ok: false, error: msg.trim() || "伺服器處理密碼變更時發生錯誤" },
      { status: 500 }
    );
  }
}
