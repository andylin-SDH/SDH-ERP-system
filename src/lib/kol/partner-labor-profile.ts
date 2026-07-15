/**
 * KOL 勞報個人資料（存 partners，填一次後自動帶入）
 */

import { getSupabase } from "@/lib/supabase/server";

export type KolLaborProfile = {
  身分證字號: string;
  聯絡電話: string;
  戶籍地址: string;
};

const EMPTY: KolLaborProfile = { 身分證字號: "", 聯絡電話: "", 戶籍地址: "" };

function isMissingColumnError(error: { code?: string; message?: string }): boolean {
  const msg = String(error.message ?? "");
  return error.code === "42703" || msg.includes("does not exist") || msg.includes("schema cache");
}

export async function getPartnerLaborProfile(partnerId: string): Promise<KolLaborProfile> {
  const pid = String(partnerId ?? "").trim();
  if (!pid) return { ...EMPTY };

  const { data, error } = await getSupabase()
    .from("partners")
    .select('"勞報身分證字號","勞報聯絡電話","勞報戶籍地址"')
    .eq("PartnerID", pid)
    .maybeSingle();

  if (error) {
    if (isMissingColumnError(error)) return { ...EMPTY };
    throw error;
  }
  if (!data) return { ...EMPTY };

  const row = data as Record<string, unknown>;
  return {
    身分證字號: String(row["勞報身分證字號"] ?? "").trim(),
    聯絡電話: String(row["勞報聯絡電話"] ?? "").trim(),
    戶籍地址: String(row["勞報戶籍地址"] ?? "").trim(),
  };
}

export async function savePartnerLaborProfile(
  partnerId: string,
  input: Partial<KolLaborProfile>
): Promise<void> {
  const pid = String(partnerId ?? "").trim();
  if (!pid) return;

  const payload: Record<string, unknown> = {};
  if (input.身分證字號 !== undefined) payload["勞報身分證字號"] = input.身分證字號.trim() || null;
  if (input.聯絡電話 !== undefined) payload["勞報聯絡電話"] = input.聯絡電話.trim() || null;
  if (input.戶籍地址 !== undefined) payload["勞報戶籍地址"] = input.戶籍地址.trim() || null;

  if (Object.keys(payload).length === 0) return;

  const { error } = await getSupabase().from("partners").update(payload).eq("PartnerID", pid);
  if (error) {
    if (isMissingColumnError(error)) return;
    throw error;
  }
}
