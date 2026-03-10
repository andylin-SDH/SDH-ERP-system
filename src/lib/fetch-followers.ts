/**
 * 粉絲數爬取：截圖 + AI 視覺辨識（YouTube / Facebook / Instagram）
 * 依環境變數選擇截圖方式：SCREENSHOT_ONE_ACCESS_KEY（建議 Vercel）或自架用 Playwright
 */

import { getPartners, updatePartner } from "@/lib/db/partners";
import { parseSocialUrls, getPlatform } from "@/lib/utils/social-urls";

const SUPPORTED_PLATFORMS = new Set(["youtube", "facebook", "instagram"]);

/** 取得網頁截圖（使用 ScreenshotOne API，適用 Vercel） */
async function captureScreenshot(url: string): Promise<Buffer> {
  const key = process.env.SCREENSHOT_ONE_ACCESS_KEY;
  if (!key) {
    throw new Error("請設定環境變數 SCREENSHOT_ONE_ACCESS_KEY（可至 screenshotone.com 申請免費額度）");
  }
  const encoded = encodeURIComponent(url);
  const apiUrl = `https://api.screenshotone.com/take?url=${encoded}&access_key=${key}&viewport_width=1280&viewport_height=800`;
  const res = await fetch(apiUrl);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`截圖失敗 (${res.status}): ${text.slice(0, 200)}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/** 用 Gemini Vision 從截圖辨識訂閱／粉絲數 */
async function extractFollowerCountWithVision(
  imageBuffer: Buffer,
  platform: "youtube" | "facebook" | "instagram"
): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("請設定環境變數 GEMINI_API_KEY");
  }
  const base64 = imageBuffer.toString("base64");
  const platformPrompt =
    platform === "youtube"
      ? "這是 YouTube 頻道頁面，請找出「訂閱者」或「subscribers」的數字。"
      : platform === "facebook"
      ? "這是 Facebook 粉絲專頁，請找出「追蹤者」或「followers」的數字。"
      : "這是 Instagram 頁面，請找出粉絲數（followers）的數字。";
  const promptText = `${platformPrompt} 只回傳數字或「萬」「K」「M」等單位（例如：1.2萬、500K），若無法辨識請回傳：unknown`;

  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=" + encodeURIComponent(apiKey),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: promptText },
              { inline_data: { mime_type: "image/png", data: base64 } },
            ],
          },
        ],
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gemini API 錯誤 (${res.status}): ${text.slice(0, 200)}`);
  }

  type GeminiPart = { text?: string };
  type GeminiContent = { parts?: GeminiPart[]; text?: string };
  type GeminiCandidate = { content?: GeminiContent };
  type GeminiResponse = { candidates?: GeminiCandidate[] };

  const json = (await res.json()) as GeminiResponse;
  const candidate = json.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const combined = parts.map((p) => p.text ?? "").join(" ").trim();
  const answer = combined || (candidate?.content?.text ?? "").trim();
  if (!answer || answer.toLowerCase() === "unknown") return null;
  return answer;
}

export interface RefreshResult {
  updated: number;
  errors: { partnerId: string; url: string; message: string }[];
}

/**
 * 為所有合作夥伴的社群連結爬取粉絲數並寫回 DB
 * @param limit 最多處理幾位合作夥伴（避免單次逾時）
 */
export async function refreshFollowersForPartners(limit = 20): Promise<RefreshResult> {
  const errors: RefreshResult["errors"] = [];
  let updated = 0;
  const partners = await getPartners();
  const toProcess = partners.slice(0, limit);

  for (const partner of toProcess) {
    const urls = parseSocialUrls(partner.社群網站);
    const byPlatform: { platform: "youtube" | "facebook" | "instagram"; url: string }[] = [];
    for (const url of urls) {
      const platform = getPlatform(url);
      if (SUPPORTED_PLATFORMS.has(platform)) {
        byPlatform.push({ platform: platform as "youtube" | "facebook" | "instagram", url });
      }
    }
    if (byPlatform.length === 0) continue;

    const parts: string[] = [];
    for (const { platform, url } of byPlatform) {
      try {
        const screenshot = await captureScreenshot(url);
        const count = await extractFollowerCountWithVision(screenshot, platform);
        const label = platform === "youtube" ? "YouTube" : platform === "facebook" ? "Facebook" : "Instagram";
        if (count) parts.push(`${label}: ${count}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({ partnerId: partner.PartnerID ?? "", url, message: msg });
      }
    }
    if (parts.length > 0) {
      const 粉絲數 = parts.join(" | ");
      const ok = await updatePartner(partner.PartnerID ?? "", { 粉絲數 });
      if (ok) updated++;
    }
  }

  return { updated, errors };
}
