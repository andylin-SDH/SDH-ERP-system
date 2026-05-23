import { getSupabase } from "@/lib/supabase/server";

export const PARTNER_AVATAR_BUCKET = "partner-avatars";
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function safePartnerStorageId(partnerId: string): string {
  return String(partnerId ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_");
}

async function ensurePartnerAvatarBucket(): Promise<void> {
  const supabase = getSupabase();
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) throw error;
  if (buckets?.some((b) => b.name === PARTNER_AVATAR_BUCKET)) return;
  const { error: createErr } = await supabase.storage.createBucket(PARTNER_AVATAR_BUCKET, {
    public: true,
    fileSizeLimit: MAX_BYTES,
    allowedMimeTypes: [...ALLOWED_MIME],
  });
  if (createErr && !/already exists/i.test(createErr.message)) {
    throw createErr;
  }
}

export function validatePartnerAvatarFile(file: File): string | null {
  if (!ALLOWED_MIME.has(file.type)) {
    return "僅支援 JPEG、PNG、WebP、GIF";
  }
  if (file.size > MAX_BYTES) {
    return "圖片不可超過 5MB";
  }
  return null;
}

export async function uploadPartnerAvatar(
  partnerId: string,
  file: Blob,
  contentType = "image/jpeg"
): Promise<string> {
  const pid = String(partnerId ?? "").trim();
  if (!pid) throw new Error("PartnerID 為必填");
  if (!ALLOWED_MIME.has(contentType)) {
    throw new Error("不支援的圖片格式");
  }
  if (file.size > MAX_BYTES) {
    throw new Error("圖片不可超過 5MB");
  }

  await ensurePartnerAvatarBucket();

  const ext =
    contentType === "image/png"
      ? "png"
      : contentType === "image/webp"
        ? "webp"
        : contentType === "image/gif"
          ? "gif"
          : "jpg";
  const objectPath = `${safePartnerStorageId(pid)}/avatar.${ext}`;

  const supabase = getSupabase();
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: uploadErr } = await supabase.storage.from(PARTNER_AVATAR_BUCKET).upload(objectPath, buffer, {
    upsert: true,
    contentType,
    cacheControl: "3600",
  });
  if (uploadErr) throw uploadErr;

  const { data } = supabase.storage.from(PARTNER_AVATAR_BUCKET).getPublicUrl(objectPath);
  const base = String(data.publicUrl ?? "").trim();
  if (!base) throw new Error("無法取得形象照 URL");
  return `${base}?v=${Date.now()}`;
}

export async function deletePartnerAvatarObject(partnerId: string): Promise<void> {
  const pid = safePartnerStorageId(String(partnerId ?? "").trim());
  if (!pid) return;
  const supabase = getSupabase();
  const { data: files } = await supabase.storage.from(PARTNER_AVATAR_BUCKET).list(pid);
  if (!files?.length) return;
  const paths = files.map((f) => `${pid}/${f.name}`);
  await supabase.storage.from(PARTNER_AVATAR_BUCKET).remove(paths);
}
