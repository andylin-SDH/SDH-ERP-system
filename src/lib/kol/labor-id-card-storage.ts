/**
 * KOL 勞報身分證正反面影本（Supabase Storage）
 */

import { getSupabase } from "@/lib/supabase/server";

export const KOL_LABOR_ID_CARD_BUCKET = "kol-labor-id-cards";
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

export type LaborIdCardSide = "front" | "back";

function safePartnerStorageId(partnerId: string): string {
  return String(partnerId ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_");
}

async function ensureBucket(): Promise<void> {
  const supabase = getSupabase();
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) throw error;
  if (buckets?.some((b) => b.name === KOL_LABOR_ID_CARD_BUCKET)) return;
  const { error: createErr } = await supabase.storage.createBucket(KOL_LABOR_ID_CARD_BUCKET, {
    public: true,
    fileSizeLimit: MAX_BYTES,
    allowedMimeTypes: [...ALLOWED_MIME],
  });
  if (createErr && !/already exists/i.test(createErr.message)) {
    throw createErr;
  }
}

export function validateLaborIdCardFile(file: File): string | null {
  if (!ALLOWED_MIME.has(file.type)) {
    return "僅支援 JPEG、PNG、WebP";
  }
  if (file.size > MAX_BYTES) {
    return "圖片不可超過 8MB";
  }
  return null;
}

export async function uploadLaborIdCard(
  partnerId: string,
  side: LaborIdCardSide,
  file: Blob,
  contentType = "image/jpeg"
): Promise<string> {
  const pid = String(partnerId ?? "").trim();
  if (!pid) throw new Error("PartnerID 為必填");
  if (side !== "front" && side !== "back") throw new Error("side 必須為 front 或 back");
  if (!ALLOWED_MIME.has(contentType)) throw new Error("不支援的圖片格式");
  if (file.size > MAX_BYTES) throw new Error("圖片不可超過 8MB");

  await ensureBucket();

  const ext = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
  const objectPath = `${safePartnerStorageId(pid)}/${side}.${ext}`;

  const supabase = getSupabase();
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: uploadErr } = await supabase.storage.from(KOL_LABOR_ID_CARD_BUCKET).upload(objectPath, buffer, {
    upsert: true,
    contentType,
    cacheControl: "3600",
  });
  if (uploadErr) throw uploadErr;

  const { data } = supabase.storage.from(KOL_LABOR_ID_CARD_BUCKET).getPublicUrl(objectPath);
  const base = String(data.publicUrl ?? "").trim();
  if (!base) throw new Error("無法取得身分證影本 URL");
  return `${base}?v=${Date.now()}`;
}
