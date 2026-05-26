"use client";

import { useEffect, useState } from "react";
import { ErpLoginPanel, fetchSessionWithRetry } from "@/components/ErpLoginPanel";
import { resolvePostLoginPath } from "@/lib/deep-link";

export default function Home() {
  const [checking, setChecking] = useState(true);
  const [loginSubtitle, setLoginSubtitle] = useState("請輸入您的帳號與密碼，登入後將導向您的專屬 Dashboard");

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const afterLogin = resolvePostLoginPath(sp);
    const hasTaskLink = afterLogin.includes("project=") || afterLogin.includes("task=");
    if (hasTaskLink) {
      setLoginSubtitle("請登入以查看任務；若您已在其他分頁登入，登入後將直接開啟該專案");
    } else if (sp.get("next")) {
      setLoginSubtitle("登入後將前往您原本要開啟的頁面");
    }

    void (async () => {
      const sess = await fetchSessionWithRetry();
      if (sess.ok && sess.user) {
        const role = String(sess.user.role ?? "").trim();
        window.location.replace(role === "KOL" ? "/kol" : afterLogin);
        return;
      }
      setChecking(false);
    })();
  }, []);

  async function handleLoginSuccess(user: Record<string, unknown>) {
    const sp = new URLSearchParams(window.location.search);
    const afterLogin = resolvePostLoginPath(sp);
    const role = String(user.role ?? "").trim();
    window.location.href = role === "KOL" ? "/kol" : afterLogin;
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#faf8f5]">
        <p className="text-stone-500">載入中...</p>
      </div>
    );
  }

  return <ErpLoginPanel subtitle={loginSubtitle} onSuccess={handleLoginSuccess} />;
}
