import { getSupabase } from "@/lib/supabase/server";

export interface MasterTaskTemplateRow {
  id: number;
  專案ID: string;
  任務名稱: string;
  任務類型: string | null;
  負責人: string | null;
  備註: string | null;
  每月幾號: number;
  提前天數: number;
  啟用: boolean;
  最後觸發鍵: string | null;
  created_at?: string;
  updated_at?: string;
}

function rowToTemplate(r: Record<string, unknown>): MasterTaskTemplateRow {
  return {
    id: Number(r.id ?? 0),
    專案ID: String(r.專案ID ?? ""),
    任務名稱: String(r.任務名稱 ?? ""),
    任務類型: (r.任務類型 as string) ?? null,
    負責人: (r.負責人 as string) ?? null,
    備註: (r.備註 as string) ?? null,
    每月幾號: Number(r.每月幾號 ?? 1),
    提前天數: Number(r.提前天數 ?? 0),
    啟用: Boolean(r.啟用),
    最後觸發鍵: (r.最後觸發鍵 as string) ?? null,
    created_at: (r.created_at as string) ?? undefined,
    updated_at: (r.updated_at as string) ?? undefined,
  };
}

export async function listMasterTaskTemplates(專案ID: string): Promise<MasterTaskTemplateRow[]> {
  const pid = String(專案ID ?? "").trim();
  if (!pid) return [];
  const { data, error } = await getSupabase()
    .from("長期案任務模板")
    .select("*")
    .eq("專案ID", pid)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => rowToTemplate(r as Record<string, unknown>));
}

export type NewMasterTaskTemplateInput = {
  專案ID: string;
  任務名稱: string;
  任務類型?: string | null;
  負責人?: string | null;
  備註?: string | null;
  每月幾號?: number;
  提前天數?: number;
  啟用?: boolean;
};

export async function createMasterTaskTemplate(payload: NewMasterTaskTemplateInput): Promise<MasterTaskTemplateRow> {
  const 專案ID = String(payload.專案ID ?? "").trim();
  const 任務名稱 = String(payload.任務名稱 ?? "").trim();
  if (!專案ID) throw new Error("專案ID 為必填");
  if (!任務名稱) throw new Error("任務名稱 為必填");
  const 每月幾號 = Math.max(1, Math.min(31, Math.floor(Number(payload.每月幾號 ?? 1) || 1)));
  const 提前天數 = Math.max(0, Math.min(31, Math.floor(Number(payload.提前天數 ?? 0) || 0)));
  const { data, error } = await getSupabase()
    .from("長期案任務模板")
    .insert({
      專案ID,
      任務名稱,
      任務類型: payload.任務類型?.trim() || null,
      負責人: payload.負責人?.trim() || null,
      備註: payload.備註?.trim() || null,
      每月幾號,
      提前天數,
      啟用: payload.啟用 !== false,
    })
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("新增模板失敗");
  return rowToTemplate(data as Record<string, unknown>);
}

export type UpdateMasterTaskTemplateInput = {
  id: number;
  任務名稱?: string | null;
  任務類型?: string | null;
  負責人?: string | null;
  備註?: string | null;
  每月幾號?: number;
  提前天數?: number;
  啟用?: boolean;
  最後觸發鍵?: string | null;
};

export async function updateMasterTaskTemplate(payload: UpdateMasterTaskTemplateInput): Promise<MasterTaskTemplateRow> {
  const id = Number(payload.id);
  if (!Number.isFinite(id) || id <= 0) throw new Error("id 不合法");
  const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (payload.任務名稱 !== undefined) updateData.任務名稱 = payload.任務名稱?.trim() || null;
  if (payload.任務類型 !== undefined) updateData.任務類型 = payload.任務類型?.trim() || null;
  if (payload.負責人 !== undefined) updateData.負責人 = payload.負責人?.trim() || null;
  if (payload.備註 !== undefined) updateData.備註 = payload.備註?.trim() || null;
  if (payload.每月幾號 !== undefined) updateData.每月幾號 = Math.max(1, Math.min(31, Math.floor(Number(payload.每月幾號) || 1)));
  if (payload.提前天數 !== undefined) updateData.提前天數 = Math.max(0, Math.min(31, Math.floor(Number(payload.提前天數) || 0)));
  if (payload.啟用 !== undefined) updateData.啟用 = Boolean(payload.啟用);
  if (payload.最後觸發鍵 !== undefined) updateData.最後觸發鍵 = payload.最後觸發鍵;
  const { data, error } = await getSupabase()
    .from("長期案任務模板")
    .update(updateData)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("更新模板失敗");
  return rowToTemplate(data as Record<string, unknown>);
}

export async function deleteMasterTaskTemplate(id: number): Promise<void> {
  const n = Number(id);
  if (!Number.isFinite(n) || n <= 0) return;
  const { error } = await getSupabase().from("長期案任務模板").delete().eq("id", n);
  if (error) throw error;
}

export async function listEnabledMasterTaskTemplates(): Promise<MasterTaskTemplateRow[]> {
  const { data, error } = await getSupabase()
    .from("長期案任務模板")
    .select("*")
    .eq("啟用", true);
  if (error) throw error;
  return (data ?? []).map((r) => rowToTemplate(r as Record<string, unknown>));
}
