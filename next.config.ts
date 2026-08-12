import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js 16 預設 Turbopack；PDF 已直接用 html2canvas-pro，不需 webpack alias
  turbopack: {},
};

export default nextConfig;
