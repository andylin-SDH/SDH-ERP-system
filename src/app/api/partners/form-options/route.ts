/**
 * GET /api/partners/form-options
 * 新增／編輯 KOL 表單用：下一個 PartnerID、類別下拉選項、Users 列表（KOL開發者）
 * 需登入；不暴露密碼，僅 name + email
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/api";
import { getNextPartnerId, getPartnerCategoryOptions } from "@/lib/db/partners";
import { getUsers } from "@/lib/db/users";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const [nextPartnerId, categories, users] = await Promise.all([
      getNextPartnerId(),
      getPartnerCategoryOptions(),
      getUsers(),
    ]);
    const userOptions = users.map((u) => ({ name: u.name, email: u.email }));
    return NextResponse.json({
      ok: true,
      nextPartnerId,
      categories,
      users: userOptions,
    });
  } catch (e) {
    console.error("GET /api/partners/form-options error:", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "載入失敗" },
      { status: 500 }
    );
  }
}
