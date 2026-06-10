import type { ReactNode } from "react";

export default function KolCatalogLayout({ children }: { children: ReactNode }) {
  return (
    <div className="kol-catalog-page min-h-screen bg-[#faf8f5] text-stone-900">{children}</div>
  );
}
