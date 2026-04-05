/**
 * API 權限檢查 Helper
 * 供各 API route 使用
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getUserByEmail } from "@/modules/users";
import type { User } from "@/lib/types";

const COOKIE_NAME = "erp_email";
export const ADMIN_ROLES = ["董事長", "管理者"] as const;

/** KOL 專用入口（與員工後台分離） */
export const KOL_ROLE = "KOL" as const;

export function getEmailFromCookie(request: NextRequest | Request): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;
  let value = match[1].trim();
  try {
    while (value !== decodeURIComponent(value)) value = decodeURIComponent(value);
  } catch {
    /* ignore */
  }
  return value || null;
}

/** 取得目前登入者，未登入回傳 null */
export async function getSessionUser(request: NextRequest | Request): Promise<User | null> {
  const email = getEmailFromCookie(request);
  if (!email) return null;
  return getUserByEmail(email);
}

/** 必須登入，否則回傳 401 */
export async function requireAuth(request: NextRequest | Request): Promise<{ user: User } | NextResponse> {
  const user = await getSessionUser(request);
  if (!user) {
    return NextResponse.json({ ok: false, error: "請先登入" }, { status: 401 });
  }
  return { user };
}

/** 必須為董事長或管理者，否則回傳 403 */
export async function requireAdmin(request: NextRequest | Request): Promise<{ user: User } | NextResponse> {
  const result = await requireAuth(request);
  if (result instanceof NextResponse) return result;
  const role = result.user.role as (typeof ADMIN_ROLES)[number] | string;
  if (!ADMIN_ROLES.includes(role as (typeof ADMIN_ROLES)[number])) {
    return NextResponse.json({ ok: false, error: "僅董事長或管理者可執行此操作" }, { status: 403 });
  }
  return result;
}

/** 必須為 KOL 角色（與員工帳號區隔） */
export async function requireKol(request: NextRequest | Request): Promise<{ user: User } | NextResponse> {
  const result = await requireAuth(request);
  if (result instanceof NextResponse) return result;
  if (String(result.user.role ?? "").trim() !== KOL_ROLE) {
    return NextResponse.json({ ok: false, error: "此操作僅限 KOL 帳號" }, { status: 403 });
  }
  return result;
}
