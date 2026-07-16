import { createHmac, timingSafeEqual } from "crypto";
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

function sessionSigningSecret(): string {
  const secret = process.env.SESSION_COOKIE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("請設定 SESSION_COOKIE_SECRET 或 SUPABASE_SERVICE_ROLE_KEY");
  return secret;
}

/** Email 不再明文作為 session；簽章可阻止使用者自行偽造管理者 Email。 */
export function encodeSessionEmail(email: string): string {
  const payload = Buffer.from(email.trim(), "utf8").toString("base64url");
  const signature = createHmac("sha256", sessionSigningSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function decodeSessionEmailCookie(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  const [payload, signature, extra] = raw.split(".");
  if (!payload || !signature || extra != null) return null;
  const expected = createHmac("sha256", sessionSigningSecret()).update(payload).digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  try {
    const email = Buffer.from(payload, "base64url").toString("utf8").trim();
    return email || null;
  } catch {
    return null;
  }
}

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
  res.cookies.set(SESSION_EMAIL_COOKIE, encodeSessionEmail(email), {
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
