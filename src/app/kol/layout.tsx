import type { ReactNode } from "react";

export default function KolLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-[#fffbf5] via-[#faf8f5] to-[#f0ebe3] text-stone-800">
      {children}
    </div>
  );
}
