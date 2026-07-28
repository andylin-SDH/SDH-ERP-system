import type { ReactNode } from "react";

export const metadata = {
  title: "週一晨會｜盛德好 ERP",
  description: "進行中專案與主責人量能檢視",
};

export default function MeetingLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-[#f4f2ed] text-stone-900 antialiased">{children}</div>;
}
