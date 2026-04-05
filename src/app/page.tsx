"use client";

import { useEffect, useState } from "react";
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

export default function Home() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    fetch("/api/auth/session", { credentials: "include", cache: "no-store" })
      .then(safeResJson)
      .then((data) => {
        if (data.ok && data.user) {
          const role = String((data.user as { role?: string }).role ?? "").trim();
          window.location.href = role === "KOL" ? "/kol" : "/dashboard";
          return;
        }
        setChecking(false);
      })
      .catch(() => setChecking(false));
  }, []);

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoggingIn(true);
    setError(null);
    fetch("/api/auth/session", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), password }),
    })
      .then(safeResJson)
      .then((data) => {
        if (!data.ok) {
          setError((data.error as string) ?? "登入失敗");
          setLoggingIn(false);
          return;
        }
        const u = data.user as { role?: string } | undefined;
        const role = String(u?.role ?? "").trim();
        window.location.href = role === "KOL" ? "/kol" : "/dashboard";
      })
      .catch(() => {
        setError("登入失敗");
        setLoggingIn(false);
      });
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#faf8f5]">
        <p className="text-stone-500">載入中...</p>
      </div>
    );
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
          <h1 className="mt-4 text-center text-2xl font-bold tracking-tight text-stone-800">
            SDH ERP 系統
          </h1>
        </div>
        <p className="mt-2 text-center text-sm text-stone-600">
          請輸入您的帳號與密碼，登入後將導向您的專屬 Dashboard
        </p>
        {error && (
          <p className="mt-3 text-center text-sm font-medium text-amber-800">{error}</p>
        )}
        <form
          onSubmit={handleLogin}
          className="mt-6 space-y-4 rounded-2xl border border-stone-200/90 bg-white p-6 shadow-lg shadow-amber-100/50 ring-1 ring-stone-100"
        >
          <div>
            <label htmlFor="email" className="block text-sm font-semibold text-stone-700">
              Email 帳號
            </label>
            <input
              id="email"
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
            <label htmlFor="password" className="block text-sm font-semibold text-stone-700">
              密碼
            </label>
            <input
              id="password"
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
            disabled={loggingIn}
            className="w-full rounded-xl bg-amber-500 py-2.5 text-sm font-bold text-stone-900 shadow-md shadow-amber-200/50 transition hover:bg-amber-400 disabled:opacity-50"
          >
            {loggingIn ? "登入中..." : "登入"}
          </button>
        </form>
      </main>
    </div>
  );
}
