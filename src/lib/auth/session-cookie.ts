import type { NextResponse } from "next/server";
import {
  SESSION_EMAIL_COOKIE,
  SESSION_EXPIRES_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/auth/session-config";

const cookieBase = {
  path: "/",
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};

export function getSessionExpiresAtFromCookieHeader(cookieHeader: string | null): number | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`${SESSION_EXPIRES_COOKIE}=([^;]+)`));
  if (!match) return null;
  const n = Number(match[1].trim());
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

export function computeSessionExpiresAtEpoch(): number {
  return Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
}

/** 設定登入 cookie（含可供前端讀取的到期時間） */
export function applySessionCookies(res: NextResponse, email: string): number {
  const expiresAt = computeSessionExpiresAtEpoch();
  res.cookies.set(SESSION_EMAIL_COOKIE, email, {
    ...cookieBase,
    httpOnly: true,
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  res.cookies.set(SESSION_EXPIRES_COOKIE, String(expiresAt), {
    ...cookieBase,
    httpOnly: false,
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return expiresAt;
}

export function clearSessionCookies(res: NextResponse): void {
  res.cookies.set(SESSION_EMAIL_COOKIE, "", { ...cookieBase, httpOnly: true, maxAge: 0 });
  res.cookies.set(SESSION_EXPIRES_COOKIE, "", { ...cookieBase, httpOnly: false, maxAge: 0 });
}
