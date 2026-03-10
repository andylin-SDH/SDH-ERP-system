/** 強制動態執行，不緩存 */
export const dynamic = "force-dynamic";

/**
 * 簡易 Session：以 Cookie 儲存目前登入者 email
 * GET：取得目前使用者
 * POST：登入（傳入 email + password，與 Users 試算表 密碼 欄比對）
 * DELETE：登出
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserByEmail, verifyCredentials } from "@/modules/users";
import { log } from "@/lib/log";

const COOKIE_NAME = "erp_email";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 天

function getEmailFromCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;
  let value = match[1].trim();
  try {
    while (value !== decodeURIComponent(value)) value = decodeURIComponent(value);
  } catch {
    /* 已非 encoded 字串則忽略 */
  }
  return value || null;
}

const noCache = { "Cache-Control": "no-store, no-cache, must-revalidate" };

export async function GET(request: NextRequest) {
  const cookieHeader = request.headers.get("cookie");
  const email = getEmailFromCookie(cookieHeader);
  log("auth.session", "GET session", { hasCookie: !!cookieHeader?.includes(COOKIE_NAME), email: email ? `${email.slice(0, 25)}` : null, decoded: !!email });
  if (!email) {
    log("auth.session", "GET 無 cookie，回傳 ok:false", {});
    return NextResponse.json({ ok: false, user: null }, { headers: noCache });
  }
  const user = await getUserByEmail(email);
  if (!user) {
    log("auth.session", "GET getUserByEmail 無此人，清除 cookie 並回傳 ok:false", { email: email.slice(0, 25) });
    const res = NextResponse.json({ ok: false, user: null }, { headers: noCache });
    res.cookies.set(COOKIE_NAME, "", { maxAge: 0, path: "/" });
    return res;
  }
  log("auth.session", "GET 成功", { email: user.email, role: user.role });
  return NextResponse.json({ ok: true, user }, { headers: noCache });
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
  const res = NextResponse.json({ ok: true, user }, { headers: noCache });
  res.cookies.set(COOKIE_NAME, user.email, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, "", { maxAge: 0, path: "/" });
  return res;
}
