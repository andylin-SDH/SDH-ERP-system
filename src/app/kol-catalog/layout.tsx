import type { ReactNode } from "react";

export const metadata = {
  title: "盛德好 合作KOL名單",
  description: "盛德好合作KOL名單，供品牌提案與媒合參考。",
};

export default function KolCatalogLayout({ children }: { children: ReactNode }) {
  return (
    <div className="kol-catalog-page min-h-screen bg-[#f6f3ee] text-stone-900 antialiased">
      <style>{`
        @keyframes kol-cat-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .kol-cat-card {
          animation: kol-cat-in 0.45s ease-out both;
        }
        .kol-cat-title {
          text-shadow:
            0 1px 2px rgba(0, 0, 0, 0.85),
            0 4px 18px rgba(0, 0, 0, 0.55),
            0 0 1px rgba(0, 0, 0, 1);
        }
        .kol-cat-reveal {
          display: grid;
          grid-template-rows: 0fr;
          transition: grid-template-rows 0.32s ease;
        }
        .kol-cat-reveal-inner {
          overflow: hidden;
          min-height: 0;
          opacity: 0;
          transform: translateY(8px);
          transition: opacity 0.28s ease, transform 0.28s ease;
        }
        .kol-cat-card:hover .kol-cat-reveal,
        .kol-cat-card:focus-visible .kol-cat-reveal {
          grid-template-rows: 1fr;
        }
        .kol-cat-card:hover .kol-cat-reveal-inner,
        .kol-cat-card:focus-visible .kol-cat-reveal-inner {
          opacity: 1;
          transform: translateY(0);
        }
        /* 觸控裝置沒有精確 hover：預設展開，避免看不到預覽 */
        @media (hover: none) {
          .kol-cat-reveal { grid-template-rows: 1fr; }
          .kol-cat-reveal-inner {
            opacity: 1;
            transform: none;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .kol-cat-card { animation: none; }
          .kol-cat-reveal,
          .kol-cat-reveal-inner { transition: none; }
        }
      `}</style>
      {children}
    </div>
  );
}
