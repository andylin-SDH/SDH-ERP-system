import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SDH ERP 系統",
  description: "公司內部 ERP 系統",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-TW">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
