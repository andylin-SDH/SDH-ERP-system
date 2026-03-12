/**
 * 已上架 KOL 變更申請（不直接改 partners，核准後才套用）
 */

import { getSupabase } from "@/lib/supabase/server";
import { log } from "@/lib/log";
import { PARTNER_STATUS } from "@/lib/db/partner-approval";
import { updatePartner, type UpdatePartnerInput, getPartnersWithError } from "@/lib/db/partners";
import type { PartnerRow } from "@/modules/partners/types";

export interface PartnerChangeRequestRow {
  id: string;
  PartnerID: string;
  變更內容: Record<string, unknown>;
  變更前快照?: Record<string, unknown>;
  審核狀態: string;
  建立者?: string;
  駁回理由?: string;
  created_at?: string;
}

function rowToRequest(r: Record<string, unknown>): PartnerChangeRequestRow {
  return {
    id: String(r.id ?? ""),
    PartnerID: String(r.PartnerID ?? r["PartnerID"] ?? ""),
    變更內容: (r["變更內容"] as Record<string, unknown>) ?? {},
    變更前快照: (r["變更前快照"] as Record<string, unknown>) ?? undefined,
    審核狀態: String(r["審核狀態"] ?? PARTNER_STATUS.PENDING),
    建立者: (r["建立者"] as string) || undefined,
    駁回理由: (r["駁回理由"] as string) || undefined,
    created_at: r.created_at as string | undefined,
  };
}

/** 同一 PartnerID 僅保留一筆待審核：新申請覆蓋舊的待審核 */
export async function upsertPendingChangeRequest(
  PartnerID: string,
  變更內容: Record<string, unknown>,
  建立者: string,
  變更前快照: Record<string, unknown>
): Promise<{ row: PartnerChangeRequestRow | null; error: string | null }> {
  const supabase = getSupabase();
  try {
    // 同 PartnerID 只保留一筆：刪除既有（新申請取代）
    const { error: delErr } = await supabase
      .from("partner_change_requests")
      .delete()
      .eq("PartnerID", PartnerID);
    if (delErr) {
      log("partner_change_requests", "delete 失敗（表可能不存在）", { error: delErr.message });
      if (delErr.message.includes("relation") || delErr.message.includes("does not exist")) {
        return { row: null, error: "資料表 partner_change_requests 不存在，請在 Supabase 執行 migration 024。" };
      }
    }

    // PostgREST 對中文欄位：insert 用與 migration 相同的雙引號欄位名對應的 key
    const insertPayload: Record<string, unknown> = {
      PartnerID,
      變更內容: 變更內容 as object,
      變更前快照: 變更前快照 as object,
      審核狀態: PARTNER_STATUS.PENDING,
      建立者,
    };

    const { data, error } = await supabase
      .from("partner_change_requests")
      .insert(insertPayload)
      .select("*")
      .maybeSingle();

    if (error) {
      log("partner_change_requests", "insert 失敗", { error: error.message, code: error.code });
      return { row: null, error: error.message };
    }
    if (!data) {
      return {
        row: null,
        error:
          "寫入後未回傳資料（常見原因：RLS 未開放 insert，或表未建立）。請在 Supabase 執行 024 並為 partner_change_requests 加上 RLS policy。",
      };
    }
    return { row: rowToRequest(data as Record<string, unknown>), error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("partner_change_requests", "upsert 例外", { error: msg });
    return { row: null, error: msg };
  }
}

export async function listChangeRequestsPending(
  userEmail: string,
  isAdmin: boolean
): Promise<PartnerChangeRequestRow[]> {
  const supabase = getSupabase();
  const email = String(userEmail ?? "").trim().toLowerCase();
  let q = supabase
    .from("partner_change_requests")
    .select("*")
    .in("審核狀態", [PARTNER_STATUS.PENDING, PARTNER_STATUS.REJECTED])
    .order("created_at", { ascending: false });

  const { data, error } = await q;
  if (error || !data) return [];

  let list = (data as Record<string, unknown>[]).map(rowToRequest);
  if (!isAdmin && email) {
    list = list.filter((r) => String(r.建立者 ?? "").trim().toLowerCase() === email);
  }
  return list;
}

export async function approveChangeRequest(id: string): Promise<PartnerRow | null> {
  const supabase = getSupabase();
  const { data: row, error } = await supabase
    .from("partner_change_requests")
    .select("*")
    .eq("id", id)
    .eq("審核狀態", PARTNER_STATUS.PENDING)
    .single();

  if (error || !row) return null;
  const r = row as Record<string, unknown>;
  const PartnerID = String(r.PartnerID ?? "");
  const 變更內容 = (r["變更內容"] as Record<string, unknown>) ?? {};
  const payload = 變更內容 as UpdatePartnerInput;
  const partner = await updatePartner(PartnerID, payload);
  if (!partner) return null;

  await supabase.from("partner_change_requests").delete().eq("id", id);

  return partner;
}

export async function rejectChangeRequest(id: string, 駁回理由: string | null): Promise<boolean> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("partner_change_requests")
    .update({ 審核狀態: PARTNER_STATUS.REJECTED, 駁回理由: 駁回理由 ?? null })
    .eq("id", id)
    .eq("審核狀態", PARTNER_STATUS.PENDING);
  return !error;
}

/** 建立變更前快照：只含 變更內容 裡有的 key */
export function buildSnapshotForKeys(partner: PartnerRow, keys: string[]): Record<string, unknown> {
  const snap: Record<string, unknown> = {};
  const p = partner as unknown as Record<string, unknown>;
  for (const k of keys) {
    if (p[k] !== undefined) snap[k] = p[k];
  }
  return snap;
}
