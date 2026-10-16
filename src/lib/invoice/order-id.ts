import { getSupabase } from "@/lib/supabase/server";

/** 第一張用專案 ID 當訂單編號；同一專案再開時加尾碼，避免光貿回訂單編號重複。 */
export async function orderIdForIssue(projectId: string): Promise<string> {
  if (!projectId) return `SDH-${Date.now()}`;
  const supabase = getSupabase();
  const { data: master, error: masterErr } = await supabase
    .from("大總表")
    .select("專案ID")
    .eq("專案ID", projectId)
    .maybeSingle();
  if (masterErr) throw masterErr;
  if (!master) throw new Error("找不到這個專案");
  const { count, error } = await supabase
    .from("發票")
    .select("id", { count: "exact", head: true })
    .eq("專案ID", projectId);
  if (error) throw error;
  if (!count) {
    if (projectId.length > 40) throw new Error("專案 ID 超過 40 字，光貿訂單編號放不下");
    return projectId;
  }
  const suffix = `-${count + 1}`;
  const room = 40 - suffix.length;
  return `${projectId.slice(0, Math.max(1, room))}${suffix}`;
}
