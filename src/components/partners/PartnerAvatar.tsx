"use client";

import { useRef, useState } from "react";
import type { PartnerRow } from "@/modules/partners";
import { cropImageFileToSquareJpeg } from "@/lib/partners/avatar-crop";

type PartnerAvatarSize = "sm" | "md" | "lg";

const SIZE_CLS: Record<PartnerAvatarSize, string> = {
  sm: "h-9 w-9 rounded-lg text-xs",
  md: "h-11 w-11 rounded-xl text-sm",
  lg: "h-28 w-28 rounded-2xl text-2xl",
};

function partnerInitial(name: string): string {
  const t = name.trim();
  if (!t) return "?";
  return t.charAt(0);
}

function avatarSrc(url: string | null | undefined): string | null {
  const raw = String(url ?? "").trim();
  return raw || null;
}

export function PartnerAvatar({
  partner,
  size = "md",
  editable = false,
  onUpdated,
}: {
  partner: Pick<PartnerRow, "PartnerID" | "合作夥伴名稱" | "形象照">;
  size?: PartnerAvatarSize;
  editable?: boolean;
  onUpdated?: (partner: PartnerRow) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = String(partner.合作夥伴名稱 ?? "").trim();
  const src = avatarSrc(partner.形象照);
  const sizeCls = SIZE_CLS[size];

  const uploadFile = async (file: File) => {
    const pid = String(partner.PartnerID ?? "").trim();
    if (!pid) return;
    setError(null);
    setUploading(true);
    try {
      const cropped = await cropImageFileToSquareJpeg(file);
      const formData = new FormData();
      formData.append("PartnerID", pid);
      formData.append("file", cropped, "avatar.jpg");
      const res = await fetch("/api/partners/avatar", { method: "POST", body: formData });
      const data = (await res.json()) as { ok?: boolean; error?: string; partner?: PartnerRow };
      if (!res.ok || !data.ok || !data.partner) {
        setError(data.error ?? "上傳失敗");
        return;
      }
      onUpdated?.(data.partner);
    } catch (e) {
      setError(e instanceof Error ? e.message : "上傳失敗");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const removeAvatar = async () => {
    const pid = String(partner.PartnerID ?? "").trim();
    if (!pid || !src) return;
    if (!window.confirm("確定要移除形象照？")) return;
    setError(null);
    setUploading(true);
    try {
      const res = await fetch(`/api/partners/avatar?PartnerID=${encodeURIComponent(pid)}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; partner?: PartnerRow };
      if (!res.ok || !data.ok || !data.partner) {
        setError(data.error ?? "移除失敗");
        return;
      }
      onUpdated?.(data.partner);
    } catch (e) {
      setError(e instanceof Error ? e.message : "移除失敗");
    } finally {
      setUploading(false);
    }
  };

  const inner = src ? (
    // eslint-disable-next-line @next/next/no-img-element -- Supabase 公開 URL，動態網域
    <img src={src} alt={name || "KOL 形象照"} className={`${sizeCls} shrink-0 object-cover`} />
  ) : (
    <div
      className={`flex ${sizeCls} shrink-0 items-center justify-center bg-stone-800 font-bold text-white`}
    >
      {partnerInitial(name)}
    </div>
  );

  if (!editable) {
    return inner;
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="group relative">
        <button
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="relative block overflow-hidden ring-2 ring-transparent transition hover:ring-amber-400/60 disabled:opacity-60"
          title="上傳正方形形象照"
        >
          {inner}
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-stone-900/0 text-[10px] font-semibold text-white opacity-0 transition group-hover:bg-stone-900/45 group-hover:opacity-100">
            {uploading ? "上傳中…" : src ? "更換" : "上傳"}
          </span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void uploadFile(file);
          }}
        />
      </div>
      {size === "lg" && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[11px] text-stone-500">建議正方形；系統會自動中心裁切。</p>
          {src ? (
            <button
              type="button"
              disabled={uploading}
              onClick={() => void removeAvatar()}
              className="text-[11px] font-semibold text-red-600 hover:underline disabled:opacity-50"
            >
              移除
            </button>
          ) : null}
        </div>
      )}
      {error ? <p className="max-w-[14rem] text-[11px] text-red-600">{error}</p> : null}
    </div>
  );
}
