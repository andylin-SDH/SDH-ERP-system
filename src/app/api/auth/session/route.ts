/** 強制動態執行，不緩存 */
export const dynamic = "force-dynamic";

/**
 * 簡易 Session：以 Cookie 儲存目前登入者 email
 * GET：取得目前使用者與到期時間
 * POST：登入
 * PATCH：延長登入（重設 cookie 有效期限）
 * DELETE：登出
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserByEmail, verifyCredentials } from "@/modules/users";
import { log } from "@/lib/log";
import { SESSION_EMAIL_COOKIE } from "@/lib/auth/session-config";
import {
  applySessionCookies,
  clearSessionCookies,
  computeSessionExpiresAtEpoch,
  decodeSessionEmailCookie,
  getSessionExpiresAtFromCookieHeader,
} from "@/lib/auth/session-cookie";

function getEmailFromCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`${SESSION_EMAIL_COOKIE}=([^;]+)`));
  if (!match) return null;
  let value = match[1].trim();
  try {
    while (value !== decodeURIComponent(value)) value = decodeURIComponent(value);
  } catch {
    /* 已非 encoded 字串則忽略 */
  }
  return decodeSessionEmailCookie(value);
}

const noCache = { "Cache-Control": "no-store, no-cache, must-revalidate" };

function sessionPayload(expiresAt: number) {
  return { expiresAt };
}

export async function GET(request: NextRequest) {
  const cookieHeader = request.headers.get("cookie");
  const email = getEmailFromCookie(cookieHeader);
  log("auth.session", "GET session", {
    hasCookie: !!cookieHeader?.includes(SESSION_EMAIL_COOKIE),
    email: email ? `${email.slice(0, 25)}` : null,
    decoded: !!email,
  });
  if (!email) {
    log("auth.session", "GET 無 cookie，回傳 ok:false", {});
    return NextResponse.json({ ok: false, user: null }, { headers: noCache });
  }
  const user = await getUserByEmail(email);
  if (!user) {
    log("auth.session", "GET getUserByEmail 無此人，清除 cookie 並回傳 ok:false", { email: email.slice(0, 25) });
    const res = NextResponse.json({ ok: false, user: null }, { headers: noCache });
    clearSessionCookies(res);
    return res;
  }

  const cookieExpiresAt = getSessionExpiresAtFromCookieHeader(cookieHeader);
  const needsExpiryBackfill = cookieExpiresAt == null;
  const expiresAt = cookieExpiresAt ?? computeSessionExpiresAtEpoch();

  const res = NextResponse.json({ ok: true, user, session: sessionPayload(expiresAt) }, { headers: noCache });
  if (needsExpiryBackfill) applySessionCookies(res, email);

  log("auth.session", "GET 成功", { email: user.email, role: user.role, expiresAt });
  return res;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  log("auth.session", "POST 登入", { email: email?.slice(0, 25), hasPassword: !!password });
  if (!email) {
    log("auth.session", "POST 缺少 email", {});
    return NextResponse.json({ ok: false, error: "請提供 email" }, { status: 400 });
  }
  if (!password) {
    log("auth.session", "POST 缺少密碼", {});
    return NextResponse.json({ ok: false, error: "請提供密碼" }, { status: 400 });
  }
  const user = await verifyCredentials(email, password);
  if (!user) {
    log("auth.session", "POST verifyCredentials 失敗", { email: email.slice(0, 25) });
    return NextResponse.json({ ok: false, error: "Email 或密碼錯誤" }, { status: 401 });
  }

  log("auth.session", "POST 登入成功，設定 cookie", { email: user.email, role: user.role });
  const expiresAt = computeSessionExpiresAtEpoch();
  const res = NextResponse.json({ ok: true, user, session: sessionPayload(expiresAt) }, { headers: noCache });
  applySessionCookies(res, user.email);
  return res;
}

/** 延長登入：重設 cookie 有效期限（須仍為有效 session） */
export async function PATCH(request: NextRequest) {
  const cookieHeader = request.headers.get("cookie");
  const email = getEmailFromCookie(cookieHeader);
  if (!email) {
    return NextResponse.json({ ok: false, error: "未登入" }, { status: 401, headers: noCache });
  }
  const user = await getUserByEmail(email);
  if (!user) {
    const res = NextResponse.json({ ok: false, error: "未登入" }, { status: 401, headers: noCache });
    clearSessionCookies(res);
    return res;
  }
  const expiresAt = computeSessionExpiresAtEpoch();
  const res = NextResponse.json({ ok: true, user, session: sessionPayload(expiresAt) }, { headers: noCache });
  applySessionCookies(res, user.email);
  log("auth.session", "PATCH 延長登入", { email: user.email, expiresAt });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  clearSessionCookies(res);
  return res;
}
