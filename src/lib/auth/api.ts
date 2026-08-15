/**
 * API 權限檢查 Helper
 * 供各 API route 使用
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getUserByEmail } from "@/modules/users";
import type { User } from "@/lib/types";

import { SESSION_EMAIL_COOKIE } from "@/lib/auth/session-config";

const COOKIE_NAME = SESSION_EMAIL_COOKIE;
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

/** 必須為員工後台帳號（KOL 老師入口不可呼叫員工 API） */
export async function requireEmployee(request: NextRequest | Request): Promise<{ user: User } | NextResponse> {
  const result = await requireAuth(request);
  if (result instanceof NextResponse) return result;
  if (String(result.user.role ?? "").trim() === KOL_ROLE) {
    return NextResponse.json(
      { ok: false, error: "KOL 帳號僅可使用老師專屬入口（/kol）" },
      { status: 403 }
    );
  }
  return result;
}

/** 必須為董事長或管理者，否則回傳 403 */
export async function requireAdmin(request: NextRequest | Request): Promise<{ user: User } | NextResponse> {
  const result = await requireEmployee(request);
  if (result instanceof NextResponse) return result;
  const role = result.user.role as (typeof ADMIN_ROLES)[number] | string;
  if (!ADMIN_ROLES.includes(role as (typeof ADMIN_ROLES)[number])) {
    return NextResponse.json({ ok: false, error: "僅董事長或管理者可執行此操作" }, { status: 403 });
  }
  return result;
}

/** 必須為董事長（稽核中心等） */
export async function requireChairman(request: NextRequest | Request): Promise<{ user: User } | NextResponse> {
  const result = await requireEmployee(request);
  if (result instanceof NextResponse) return result;
  if (String(result.user.role ?? "").trim() !== "董事長") {
    return NextResponse.json({ ok: false, error: "僅董事長可執行此操作" }, { status: 403 });
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

/** 可編輯專案「額外獎金」的角色（董事長／會計） */
export const EXTRA_BONUS_EDIT_ROLES = ["董事長", "會計"] as const;

export function canEditExtraBonus(role: string | undefined | null): boolean {
  const r = String(role ?? "").trim();
  return (EXTRA_BONUS_EDIT_ROLES as readonly string[]).includes(r);
}

/** 員工且具備額外獎金編輯權限 */
export async function requireExtraBonusEditor(
  request: NextRequest | Request
): Promise<{ user: User } | NextResponse> {
  const result = await requireEmployee(request);
  if (result instanceof NextResponse) return result;
  if (!canEditExtraBonus(result.user.role)) {
    return NextResponse.json({ ok: false, error: "僅董事長或會計可編輯額外獎金" }, { status: 403 });
  }
  return result;
}

/** 可預覽 KOL 老師入口的員工角色（董事長／管理者／會計） */
export const KOL_PORTAL_PREVIEW_ROLES = ["董事長", "管理者", "會計"] as const;

export function canPreviewKolPortal(role: string | undefined | null): boolean {
  const r = String(role ?? "").trim();
  return (KOL_PORTAL_PREVIEW_ROLES as readonly string[]).includes(r);
}

/** 員工且具備 KOL 老師視角預覽權限 */
export async function requireKolPortalPreview(
  request: NextRequest | Request
): Promise<{ user: User } | NextResponse> {
  const result = await requireEmployee(request);
  if (result instanceof NextResponse) return result;
  if (!canPreviewKolPortal(result.user.role)) {
    return NextResponse.json(
      { ok: false, error: "僅董事長、管理者或會計可預覽 KOL 老師視角" },
      { status: 403 }
    );
  }
  return result;
}
