/**
 * 社群網站 URL 解析與平台辨識
 * 儲存格式：換行或逗號分隔，DB 仍為 text 欄位
 */

export type SocialPlatform = "facebook" | "instagram" | "youtube" | "line" | "linkedin" | "twitter" | "link";

/** 從字串解析多筆 URL（換行、逗號、空白分隔） */
export function parseSocialUrls(text: string | null | undefined): string[] {
  if (!text || typeof text !== "string") return [];
  return text
    .split(/[\n,，\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && /^https?:\/\//i.test(s));
}

/** 依 URL 判斷平台 */
export function getPlatform(url: string): SocialPlatform {
  const lower = url.toLowerCase();
  if (lower.includes("facebook.com") || lower.includes("fb.com")) return "facebook";
  if (lower.includes("instagram.com")) return "instagram";
  if (lower.includes("youtube.com") || lower.includes("youtu.be")) return "youtube";
  if (lower.includes("line.me") || lower.includes("line-app")) return "line";
  if (lower.includes("linkedin.com")) return "linkedin";
  if (lower.includes("twitter.com") || lower.includes("x.com")) return "twitter";
  return "link";
}
