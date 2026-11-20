"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ProductionCaseApp } from "@/components/production-case/ProductionCaseApp";
import { fetchSessionWithRetry } from "@/components/ErpLoginPanel";

/** 依角色導向對應入口；內部人員看全功能 */
export default function ProductionCasePage() {
  const router = useRouter();

  useEffect(() => {
    void (async () => {
      const sess = await fetchSessionWithRetry();
      if (!sess.ok || !sess.user) {
        router.replace("/");
        return;
      }
      const role = String(sess.user.role ?? "").trim();
      if (role === "外包") router.replace("/production-case/vendor");
      else if (role === "製作案主") router.replace("/production-case/client");
      else if (role === "KOL") router.replace("/production-case/kol");
    })();
  }, [router]);

  return <ProductionCaseApp />;
}
