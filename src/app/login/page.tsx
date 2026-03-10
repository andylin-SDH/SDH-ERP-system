"use client";

import { useEffect } from "react";

/**
 * 登入頁：導向首頁（首頁即登入表單）
 */
export default function LoginPage() {
  useEffect(() => {
    window.location.replace("/");
  }, []);
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50">
      <p className="text-zinc-500">導向登入...</p>
    </div>
  );
}
