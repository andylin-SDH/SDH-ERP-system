import type { ReactNode } from "react";

export const metadata = {
  title: "盛德好 合作KOL名單",
  description: "盛德好合作KOL名單，供品牌提案與媒合參考。",
};

export default function KolCatalogLayout({ children }: { children: ReactNode }) {
  return (
    <div className="kol-catalog-page min-h-screen bg-[#f6f3ee] text-stone-900 antialiased">{children}</div>
  );
}
