"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  SESSION_POLL_INTERVAL_MS,
  SESSION_WARN_BEFORE_SECONDS,
} from "@/lib/auth/session-config";

async function safeResJson(r: Response): Promise<Record<string, unknown>> {
  const text = await r.text();
  if (!text.trim()) return {};
  try {
    return (JSON.parse(text) as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

function readExpiresAtFromDocumentCookie(): number | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)erp_session_exp=([^;]+)/);
  if (!match) return null;
  const n = Number(decodeURIComponent(match[1]).trim());
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function formatRemainingSeconds(totalSec: number): string {
  const sec = Math.max(0, totalSec);
  if (sec >= 3600) {
    const h = Math.floor(sec / 3600);
    const m = Math.ceil((sec % 3600) / 60);
    return m > 0 ? `${h} 小時 ${m} 分鐘` : `${h} 小時`;
  }
  const m = Math.ceil(sec / 60);
  return m <= 1 ? "不到 1 分鐘" : `${m} 分鐘`;
}

type SessionExpiryMonitorProps = {
  active: boolean;
  /** session 已失效（過期或伺服器拒絕） */
  onSessionEnd: (reason: "expired" | "invalid") => void;
};

/**
 * 登入到期前提醒，並提供「延長登入」；過期時顯示遮罩，避免無預警被登出。
 */
export function SessionExpiryMonitor({ active, onSessionEnd }: SessionExpiryMonitorProps) {
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [remainingSec, setRemainingSec] = useState<number | null>(null);
  const [phase, setPhase] = useState<"ok" | "warning" | "expired">("ok");
  const [extending, setExtending] = useState(false);
  const [dismissedWarning, setDismissedWarning] = useState(false);
  const endedRef = useRef(false);

  const syncFromServer = useCallback(async (): Promise<boolean> => {
    const res = await fetch("/api/auth/session", { credentials: "include", cache: "no-store" });
    const data = (await safeResJson(res)) as {
      ok?: boolean;
      session?: { expiresAt?: number };
    };
    if (!res.ok || !data.ok) return false;
    const fromApi = Number(data.session?.expiresAt ?? 0);
    const fromCookie = readExpiresAtFromDocumentCookie();
    const exp = fromApi > 0 ? fromApi : fromCookie;
    if (exp) setExpiresAt(exp);
    return Boolean(exp);
  }, []);

  const refreshSession = useCallback(async (): Promise<boolean> => {
    setExtending(true);
    try {
      const res = await fetch("/api/auth/session", { method: "PATCH", credentials: "include", cache: "no-store" });
      const data = (await safeResJson(res)) as { ok?: boolean; session?: { expiresAt?: number } };
      if (!res.ok || !data.ok) return false;
      const exp = Number(data.session?.expiresAt ?? 0) || readExpiresAtFromDocumentCookie();
      if (exp) setExpiresAt(exp);
      setPhase("ok");
      setDismissedWarning(false);
      setRemainingSec(null);
      return true;
    } finally {
      setExtending(false);
    }
  }, []);

  const finishSession = useCallback(
    async (reason: "expired" | "invalid") => {
      await fetch("/api/auth/session", { method: "DELETE", credentials: "include" });
      if (!endedRef.current) endedRef.current = true;
      onSessionEnd(reason);
    },
    [onSessionEnd]
  );

  useEffect(() => {
    if (!active) return;
    endedRef.current = false;
    setPhase("ok");
    setDismissedWarning(false);
    void syncFromServer();
  }, [active, syncFromServer]);

  useEffect(() => {
    if (!active) return;

    const tick = async () => {
      const now = Math.floor(Date.now() / 1000);
      let exp = expiresAt ?? readExpiresAtFromDocumentCookie();

      if (!exp) {
        const ok = await syncFromServer();
        if (!ok && !endedRef.current) {
          endedRef.current = true;
          setPhase("expired");
          return;
        }
        exp = expiresAt ?? readExpiresAtFromDocumentCookie();
      }

      if (!exp) return;

      const left = exp - now;
      setRemainingSec(left);

      if (left <= 0) {
        if (!endedRef.current) {
          endedRef.current = true;
          setPhase("expired");
        }
        return;
      }

      if (left <= SESSION_WARN_BEFORE_SECONDS) {
        setPhase("warning");
      } else {
        setPhase("ok");
        setDismissedWarning(false);
      }
    };

    void tick();
    const id = window.setInterval(() => void tick(), SESSION_POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [active, expiresAt, onSessionEnd, syncFromServer]);

  useEffect(() => {
    if (!active || phase !== "warning") return;
    const onVis = () => {
      if (document.visibilityState === "visible") void syncFromServer();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [active, phase, syncFromServer]);

  if (!active) return null;

  if (phase === "expired") {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-stone-900/45 p-4 backdrop-blur-sm">
        <div
          role="alertdialog"
          aria-labelledby="session-expired-title"
          className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-6 shadow-2xl ring-1 ring-stone-200/80"
        >
          <h2 id="session-expired-title" className="text-lg font-bold text-stone-900">
            登入已過期
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-stone-600">
            您的登入時段已結束。為保護帳號安全，系統已結束本次登入，請重新登入後再繼續操作。
          </p>
          <button
            type="button"
            onClick={() => void finishSession("expired")}
            className="mt-5 w-full rounded-xl bg-amber-500 py-2.5 text-sm font-bold text-slate-900 shadow-md hover:bg-amber-400"
          >
            重新登入
          </button>
        </div>
      </div>
    );
  }

  if (phase === "warning" && !dismissedWarning) {
    return (
      <div className="fixed inset-x-0 bottom-0 z-[90] flex justify-center p-4 sm:bottom-6">
        <div
          role="alertdialog"
          aria-labelledby="session-warn-title"
          className="w-full max-w-lg rounded-2xl border border-amber-300/80 bg-amber-50 px-4 py-4 shadow-xl ring-1 ring-amber-200/80 sm:px-5"
        >
          <h2 id="session-warn-title" className="text-sm font-bold text-amber-950">
            登入即將到期
          </h2>
          <p className="mt-1 text-sm text-amber-900/90">
            約剩 <strong className="tabular-nums">{formatRemainingSeconds(remainingSec ?? 0)}</strong>
            ，時間到後系統會結束登入。若您仍在操作，請按「延長登入」。
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={extending}
              onClick={() => void refreshSession()}
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-slate-900 shadow-sm hover:bg-amber-400 disabled:opacity-60"
            >
              {extending ? "延長中…" : "延長登入"}
            </button>
            <button
              type="button"
              onClick={() => void finishSession("expired")}
              className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50"
            >
              登出
            </button>
            <button
              type="button"
              onClick={() => setDismissedWarning(true)}
              className="rounded-lg px-3 py-2 text-sm font-medium text-amber-900/80 hover:bg-amber-100/80"
            >
              稍後提醒
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
