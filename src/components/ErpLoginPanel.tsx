"use client";

import { useState } from "react";
import Image from "next/image";

async function safeResJson(r: Response): Promise<Record<string, unknown>> {
  const text = await r.text();
  if (!text.trim()) return {};
  try {
    return (JSON.parse(text) as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

type ErpLoginPanelProps = {
  subtitle?: string;
  onSuccess: (user: Record<string, unknown>) => void | Promise<void>;
};

/** 登入表單（首頁／Dashboard 共用） */
export function ErpLoginPanel({ subtitle, onSuccess }: ErpLoginPanelProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/session", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await safeResJson(res);
      if (!data.ok) {
        setError(String(data.error ?? "登入失敗"));
        return;
      }
      await onSuccess((data.user as Record<string, unknown>) ?? {});
    } catch {
      setError("登入失敗");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#fffbf5] via-[#faf8f5] to-[#f5f0e8] px-4">
      <main className="w-full max-w-md">
        <div className="flex flex-col items-center">
          <Image
            src="/logo.png"
            alt="SDH"
            width={1257}
            height={174}
            sizes="(max-width: 448px) 100vw, 448px"
            className="h-auto w-full max-w-[256px] object-contain drop-shadow-sm"
            priority
          />
          <h1 className="mt-4 text-center text-2xl font-bold tracking-tight text-stone-800">SDH ERP 系統</h1>
        </div>
        {subtitle ? <p className="mt-2 text-center text-sm text-stone-600">{subtitle}</p> : null}
        {error ? <p className="mt-3 text-center text-sm font-medium text-amber-800">{error}</p> : null}
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="mt-6 space-y-4 rounded-2xl border border-stone-200/90 bg-white p-6 shadow-lg shadow-amber-100/50 ring-1 ring-stone-100"
        >
          <div>
            <label htmlFor="erp-login-email" className="block text-sm font-semibold text-stone-700">
              Email 帳號
            </label>
            <input
              id="erp-login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="例如：andylin@sdh-corp.com"
              className="mt-1.5 w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200/80"
              autoComplete="email"
              required
            />
          </div>
          <div>
            <label htmlFor="erp-login-password" className="block text-sm font-semibold text-stone-700">
              密碼
            </label>
            <input
              id="erp-login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="請輸入密碼"
              className="mt-1.5 w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200/80"
              autoComplete="current-password"
              required
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-amber-500 py-2.5 text-sm font-bold text-stone-900 shadow-md shadow-amber-200/50 transition hover:bg-amber-400 disabled:opacity-50"
          >
            {submitting ? "登入中..." : "登入"}
          </button>
        </form>
      </main>
    </div>
  );
}

/** 讀取 session（含一次短暫重試，避免瞬斷誤判未登入） */
export async function fetchSessionWithRetry(): Promise<{ ok: boolean; user: Record<string, unknown> | null }> {
  const load = async () => {
    const res = await fetch("/api/auth/session", { credentials: "include", cache: "no-store" });
    const data = await safeResJson(res);
    return {
      ok: Boolean(data.ok),
      user: data.ok && data.user ? (data.user as Record<string, unknown>) : null,
    };
  };
  let result = await load();
  if (!result.ok || !result.user) {
    await new Promise((r) => setTimeout(r, 350));
    result = await load();
  }
  return result;
}
