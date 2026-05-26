"use client";

import { useEffect } from "react";

/**
 * 登入頁：導向首頁（首頁即登入表單），保留 query（next / project / task）
 */
export default function LoginPage() {
  useEffect(() => {
    const qs = window.location.search || "";
    window.location.replace(`/${qs}`);
  }, []);
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#faf8f5]">
      <p className="text-stone-500">導向登入...</p>
    </div>
  );
}
