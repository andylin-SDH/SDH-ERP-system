import type { NextConfig } from "next";
import { join } from "node:path";

const nextConfig: NextConfig = {
  // html2pdf.js 依賴舊版 html2canvas（不支援 lab/oklch）；改指向 html2canvas-pro
  webpack: (config) => {
    config.resolve = config.resolve ?? {};
    const alias = config.resolve.alias;
    const aliasObj =
      alias && typeof alias === "object" && !Array.isArray(alias)
        ? { ...(alias as Record<string, string | false | string[]>) }
        : {};
    aliasObj.html2canvas = join(process.cwd(), "node_modules/html2canvas-pro");
    config.resolve.alias = aliasObj;
    return config;
  },
};

export default nextConfig;
