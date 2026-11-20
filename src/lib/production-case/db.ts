import { getSupabase } from "@/lib/supabase/server";
import { newId } from "./lifecycle";
import type {
  PcDelivery,
  PcEpisode,
  PcMembership,
  PcPreprodTask,
  PcProgram,
  PcRecordingSession,
  PcUploadChecklist,
  PcWorkOrder,
} from "./types";

function asRows<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

export async function logPcAction(input: {
  action_type: string;
  actor_email?: string | null;
  program_id?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  status?: string | null;
  note?: string | null;
}): Promise<void> {
  const supabase = getSupabase();
  await supabase.from("pc_operation_logs").insert({
    action_type: input.action_type,
    actor_email: input.actor_email ?? null,
    program_id: input.program_id ?? null,
    entity_type: input.entity_type ?? null,
    entity_id: input.entity_id ?? null,
    status: input.status ?? null,
    note: input.note ?? null,
  });
}

export async function listPrograms(filter?: { ids?: string[] }): Promise<PcProgram[]> {
  const supabase = getSupabase();
  let q = supabase.from("pc_programs").select("*").order("created_at", { ascending: false });
  if (filter?.ids?.length) q = q.in("id", filter.ids);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return asRows<PcProgram>(data).map((p) => ({
    ...p,
    services: (typeof p.services === "object" && p.services ? p.services : {}) as Record<string, unknown>,
  }));
}

export async function getProgram(id: string): Promise<PcProgram | null> {
  const rows = await listPrograms({ ids: [id] });
  return rows[0] ?? null;
}

/** 刪除節目（子表 CASCADE；須由使用者明確觸發） */
export async function deleteProgram(id: string, actor_email?: string): Promise<void> {
  const supabase = getSupabase();
  const existing = await getProgram(id);
  if (!existing) throw new Error("找不到節目");
  await logPcAction({
    action_type: "刪除節目",
    actor_email,
    program_id: id,
    entity_type: "pc_programs",
    entity_id: id,
    status: "進行中",
    note: existing.name,
  });
  const { error } = await supabase.from("pc_programs").delete().eq("id", id);
  if (error) throw new Error(error.message);
  await logPcAction({
    action_type: "刪除節目",
    actor_email,
    program_id: id,
    entity_type: "pc_programs",
    entity_id: id,
    status: "成功",
    note: existing.name,
  });
}

export async function createProgram(input: {
  name: string;
  client_name?: string;
  pm_email?: string;
  pm_name?: string;
  note?: string;
  actor_email?: string;
}): Promise<PcProgram> {
  const supabase = getSupabase();
  const id = newId("PC");
  const row = {
    id,
    name: input.name.trim(),
    client_name: input.client_name?.trim() || null,
    workflow_stage: "待開案",
    status: "進行中",
    pm_email: input.pm_email?.trim() || null,
    pm_name: input.pm_name?.trim() || null,
    note: input.note?.trim() || null,
    updated_by: input.actor_email ?? null,
  };
  const { data, error } = await supabase.from("pc_programs").insert(row).select("*").single();
  if (error) throw new Error(error.message);
  await logPcAction({
    action_type: "建立節目",
    actor_email: input.actor_email,
    program_id: id,
    entity_type: "pc_programs",
    entity_id: id,
    status: "成功",
  });
  return data as PcProgram;
}

export async function patchProgram(
  id: string,
  patch: Record<string, unknown>,
  actor_email?: string
): Promise<PcProgram> {
  const supabase = getSupabase();
  const allowed = [
    "name",
    "client_name",
    "workflow_stage",
    "status",
    "pm_email",
    "pm_name",
    "note",
    "total_episodes",
    "first_air_date",
    "frequency",
    "services",
    "included_revisions",
    "onboarding_due_date",
    "production_completed_at",
    "client_accepted_at",
    "finance_settled_at",
    "closed_at",
  ];
  const body: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: actor_email ?? null };
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) body[key] = patch[key];
  }
  const { data, error } = await supabase.from("pc_programs").update(body).eq("id", id).select("*").single();
  if (error) throw new Error(error.message);
  await logPcAction({
    action_type: "更新節目",
    actor_email,
    program_id: id,
    entity_type: "pc_programs",
    entity_id: id,
    status: "成功",
    note: JSON.stringify(Object.keys(body)),
  });
  return data as PcProgram;
}

export async function listEpisodes(programIds?: string[]): Promise<PcEpisode[]> {
  const supabase = getSupabase();
  let q = supabase.from("pc_episodes").select("*").order("episode_no", { ascending: true });
  if (programIds?.length) q = q.in("program_id", programIds);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return asRows<PcEpisode>(data);
}

export async function createEpisode(input: {
  program_id: string;
  episode_no: number;
  season?: number;
  title: string;
  recording_date?: string;
  air_date?: string;
  actor_email?: string;
}): Promise<PcEpisode> {
  const supabase = getSupabase();
  const season = input.season ?? 1;
  const episode_no = Number(input.episode_no);
  if (!Number.isFinite(episode_no) || episode_no <= 0) throw new Error("集數必須為正整數");
  const title = input.title.trim();
  if (!title) throw new Error("標題必填");
  const id = `${input.program_id}-S${season}E${episode_no}`;
  const label = `${season}-${episode_no}`;
  const row = {
    id,
    program_id: input.program_id,
    season,
    episode_no,
    label,
    title,
    recording_date: input.recording_date?.trim() || null,
    air_date: input.air_date?.trim() || null,
    status: "預排",
    topic_status: "暫定",
    material_status: "未交接",
    guest_requirement: "待確認",
    updated_by: input.actor_email ?? null,
  };
  const { data, error } = await supabase.from("pc_episodes").insert(row).select("*").single();
  if (error) throw new Error(error.message);
  await logPcAction({
    action_type: "建立單集",
    actor_email: input.actor_email,
    program_id: input.program_id,
    entity_type: "pc_episodes",
    entity_id: id,
    status: "成功",
  });
  // 一併建立上架檢核列（僅新增；失敗不影響單集）
  await supabase.from("pc_upload_checklist").insert({
    id: `${input.program_id}-UP-${season}-${episode_no}`,
    episode_id: id,
    program_id: input.program_id,
    status: "未準備",
  });
  return data as PcEpisode;
}

export async function patchEpisode(
  id: string,
  patch: Record<string, unknown>,
  actor_email?: string
): Promise<PcEpisode> {
  const supabase = getSupabase();
  const allowed = [
    "title",
    "recording_date",
    "air_date",
    "status",
    "topic",
    "topic_status",
    "material_status",
    "guest_requirement",
    "note",
  ];
  const body: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    updated_by: actor_email ?? null,
  };
  for (const key of allowed) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    const val = patch[key];
    if (key === "title") {
      const t = String(val ?? "").trim();
      if (!t) throw new Error("標題不可空白");
      body[key] = t;
      continue;
    }
    if (key === "recording_date" || key === "air_date") {
      const d = String(val ?? "").trim();
      body[key] = d || null;
      continue;
    }
    body[key] = val;
  }
  const { data, error } = await supabase.from("pc_episodes").update(body).eq("id", id).select("*").single();
  if (error) throw new Error(error.message);
  await logPcAction({
    action_type: "更新單集",
    actor_email,
    program_id: (data as PcEpisode).program_id,
    entity_type: "pc_episodes",
    entity_id: id,
    status: "成功",
    note: JSON.stringify(Object.keys(body)),
  });
  return data as PcEpisode;
}

export async function createPreprodTask(input: {
  program_id: string;
  task_type: string;
  episode_id?: string | null;
  assignee_name?: string;
  due_date?: string;
  actor_email?: string;
}): Promise<PcPreprodTask> {
  const supabase = getSupabase();
  const task_type = input.task_type.trim();
  if (!task_type) throw new Error("任務名稱必填");
  const id = newId("PPT");
  const episode_id = input.episode_id?.trim() || null;
  const idem = `${input.program_id}|${episode_id ?? ""}|${task_type}|${id}`;
  const row = {
    id,
    program_id: input.program_id,
    episode_id,
    scope: episode_id ? "EPISODE" : "PROGRAM",
    task_type,
    assignee_name: input.assignee_name?.trim() || null,
    due_date: input.due_date?.trim() || null,
    status: "未開始",
    idempotency_key: idem,
  };
  const { data, error } = await supabase.from("pc_preprod_tasks").insert(row).select("*").single();
  if (error) throw new Error(error.message);
  await logPcAction({
    action_type: "建立前製任務",
    actor_email: input.actor_email,
    program_id: input.program_id,
    entity_type: "pc_preprod_tasks",
    entity_id: id,
    status: "成功",
  });
  return data as PcPreprodTask;
}

export async function createWorkOrder(input: {
  program_id: string;
  service_name: string;
  episode_id?: string | null;
  assignee_name?: string;
  assignee_email?: string;
  due_date?: string;
  actor_email?: string;
}): Promise<PcWorkOrder> {
  const supabase = getSupabase();
  const service_name = input.service_name.trim();
  if (!service_name) throw new Error("工單名稱必填");
  const id = newId("WO");
  const episode_id = input.episode_id?.trim() || null;
  const idem = `${episode_id ?? input.program_id}|${service_name}|${id}`;
  const row = {
    id,
    program_id: input.program_id,
    episode_id,
    service_name,
    unit_seq: 1,
    workorder_kind: "POST_PRODUCTION",
    assignee_name: input.assignee_name?.trim() || null,
    assignee_email: input.assignee_email?.trim().toLowerCase() || null,
    due_date: input.due_date?.trim() || null,
    status: "未開始",
    prereq_status: "已解鎖",
    client_billable: true,
    vendor_payable: Boolean(input.assignee_email || input.assignee_name),
    included_revisions: 2,
    revision_round: 0,
    review_status: "未送審",
    idempotency_key: idem,
  };
  const { data, error } = await supabase.from("pc_work_orders").insert(row).select("*").single();
  if (error) throw new Error(error.message);
  await logPcAction({
    action_type: "建立工單",
    actor_email: input.actor_email,
    program_id: input.program_id,
    entity_type: "pc_work_orders",
    entity_id: id,
    status: "成功",
  });
  return data as PcWorkOrder;
}

export async function createRecordingSession(input: {
  program_id: string;
  session_date?: string;
  start_time?: string;
  end_time?: string;
  studio_name?: string;
  actor_email?: string;
}): Promise<PcRecordingSession> {
  const supabase = getSupabase();
  const id = newId("RS");
  const row = {
    id,
    program_id: input.program_id,
    session_date: input.session_date?.trim() || null,
    start_time: input.start_time?.trim() || null,
    end_time: input.end_time?.trim() || null,
    studio_name: input.studio_name?.trim() || null,
    status: "暫定",
  };
  const { data, error } = await supabase.from("pc_recording_sessions").insert(row).select("*").single();
  if (error) throw new Error(error.message);
  await logPcAction({
    action_type: "建立錄音場次",
    actor_email: input.actor_email,
    program_id: input.program_id,
    entity_type: "pc_recording_sessions",
    entity_id: id,
    status: "成功",
  });
  return data as PcRecordingSession;
}

export async function listPreprodTasks(programIds?: string[]): Promise<PcPreprodTask[]> {
  const supabase = getSupabase();
  let q = supabase.from("pc_preprod_tasks").select("*").order("due_date", { ascending: true });
  if (programIds?.length) q = q.in("program_id", programIds);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return asRows<PcPreprodTask>(data);
}

export async function patchPreprodTask(
  id: string,
  patch: Record<string, unknown>,
  actor_email?: string
): Promise<PcPreprodTask> {
  const supabase = getSupabase();
  const allowed = ["status", "deliverable_url", "assignee_email", "assignee_name", "due_date", "blocked_reason", "revision_round"];
  const body: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) body[key] = patch[key];
  }
  const { data, error } = await supabase.from("pc_preprod_tasks").update(body).eq("id", id).select("*").single();
  if (error) throw new Error(error.message);
  await logPcAction({
    action_type: "更新前製任務",
    actor_email,
    program_id: (data as PcPreprodTask).program_id,
    entity_type: "pc_preprod_tasks",
    entity_id: id,
    status: "成功",
  });
  return data as PcPreprodTask;
}

export async function listWorkOrders(filter?: {
  programIds?: string[];
  assigneeEmail?: string;
}): Promise<PcWorkOrder[]> {
  const supabase = getSupabase();
  let q = supabase.from("pc_work_orders").select("*").order("due_date", { ascending: true });
  if (filter?.programIds?.length) q = q.in("program_id", filter.programIds);
  if (filter?.assigneeEmail) q = q.eq("assignee_email", filter.assigneeEmail.toLowerCase());
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return asRows<PcWorkOrder>(data);
}

export async function getWorkOrder(id: string): Promise<PcWorkOrder | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("pc_work_orders").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as PcWorkOrder) ?? null;
}

export async function patchWorkOrder(
  id: string,
  patch: Record<string, unknown>,
  actor_email?: string
): Promise<PcWorkOrder> {
  const supabase = getSupabase();
  const allowed = [
    "status",
    "prereq_status",
    "prereq_missing",
    "assignee_email",
    "assignee_name",
    "due_date",
    "revision_round",
    "review_status",
    "vendor_payable",
    "client_billable",
    "vendor_amount",
    "client_amount",
  ];
  const body: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) body[key] = patch[key];
  }
  const { data, error } = await supabase.from("pc_work_orders").update(body).eq("id", id).select("*").single();
  if (error) throw new Error(error.message);
  await logPcAction({
    action_type: "更新工單",
    actor_email,
    program_id: (data as PcWorkOrder).program_id,
    entity_type: "pc_work_orders",
    entity_id: id,
    status: "成功",
  });
  return data as PcWorkOrder;
}

export async function listDeliveries(workorderIds?: string[]): Promise<PcDelivery[]> {
  const supabase = getSupabase();
  let q = supabase.from("pc_work_order_deliveries").select("*").order("delivery_seq", { ascending: true });
  if (workorderIds?.length) q = q.in("workorder_id", workorderIds);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return asRows<PcDelivery>(data);
}

/** 送出交付：只 INSERT 新版本，舊版 is_current=false（不刪、不覆蓋 url） */
export async function submitDelivery(input: {
  workorder_id: string;
  delivery_url?: string;
  delivery_note?: string;
  submitted_by: string;
}): Promise<PcDelivery> {
  const supabase = getSupabase();
  const existing = await listDeliveries([input.workorder_id]);
  const nextSeq = existing.reduce((m, d) => Math.max(m, d.delivery_seq), 0) + 1;
  if (existing.length) {
    await supabase
      .from("pc_work_order_deliveries")
      .update({ is_current: false })
      .eq("workorder_id", input.workorder_id)
      .eq("is_current", true);
  }
  const id = newId("PCD");
  const { data, error } = await supabase
    .from("pc_work_order_deliveries")
    .insert({
      id,
      workorder_id: input.workorder_id,
      delivery_seq: nextSeq,
      delivery_url: input.delivery_url?.trim() || null,
      delivery_note: input.delivery_note?.trim() || null,
      submitted_by: input.submitted_by,
      is_current: true,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  await patchWorkOrder(input.workorder_id, { status: "待審核", review_status: "未送審" }, input.submitted_by);
  const wo = await getWorkOrder(input.workorder_id);
  await logPcAction({
    action_type: "送出交付",
    actor_email: input.submitted_by,
    program_id: wo?.program_id,
    entity_type: "pc_work_order_deliveries",
    entity_id: id,
    status: "成功",
    note: `seq=${nextSeq}`,
  });
  return data as PcDelivery;
}

export async function reviewWorkOrder(input: {
  workorder_id: string;
  result: "通過" | "退回";
  reject_reason?: string;
  reviewer_email: string;
}): Promise<PcWorkOrder> {
  const supabase = getSupabase();
  const wo = await getWorkOrder(input.workorder_id);
  if (!wo) throw new Error("找不到工單");
  const deliveries = await listDeliveries([input.workorder_id]);
  const current = [...deliveries].reverse().find((d) => d.is_current) ?? deliveries[deliveries.length - 1];
  const reviewId = newId("PCR");
  const revisionRound = input.result === "退回" ? (wo.revision_round ?? 0) + 1 : wo.revision_round ?? 0;
  const { error: revErr } = await supabase.from("pc_work_order_reviews").insert({
    id: reviewId,
    workorder_id: input.workorder_id,
    delivery_id: current?.id ?? null,
    revision_round: revisionRound,
    reviewer_email: input.reviewer_email,
    result: input.result,
    reject_reason: input.reject_reason?.trim() || null,
  });
  if (revErr) throw new Error(revErr.message);
  const nextStatus = input.result === "通過" ? "已完成" : "需修改";
  return patchWorkOrder(
    input.workorder_id,
    {
      status: nextStatus,
      review_status: input.result === "通過" ? "通過" : "未送審",
      revision_round: revisionRound,
    },
    input.reviewer_email
  );
}

export async function listUploads(programIds?: string[]): Promise<PcUploadChecklist[]> {
  const supabase = getSupabase();
  let q = supabase.from("pc_upload_checklist").select("*");
  if (programIds?.length) q = q.in("program_id", programIds);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return asRows<PcUploadChecklist>(data);
}

export async function patchUpload(
  id: string,
  patch: Record<string, unknown>,
  actor_email?: string
): Promise<PcUploadChecklist> {
  const supabase = getSupabase();
  const allowed = [
    "status",
    "final_audio_url",
    "shownotes_url",
    "cover_url",
    "final_video_url",
    "short_video_url",
    "title_confirmed",
    "platform_name",
    "upload_note",
    "uploaded_at",
  ];
  const body: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) body[key] = patch[key];
  }
  const { data, error } = await supabase.from("pc_upload_checklist").update(body).eq("id", id).select("*").single();
  if (error) throw new Error(error.message);
  await logPcAction({
    action_type: "更新上架檢核",
    actor_email,
    program_id: (data as PcUploadChecklist).program_id,
    entity_type: "pc_upload_checklist",
    entity_id: id,
    status: "成功",
  });
  return data as PcUploadChecklist;
}

export async function listSessions(programIds?: string[]): Promise<PcRecordingSession[]> {
  const supabase = getSupabase();
  let q = supabase.from("pc_recording_sessions").select("*").order("session_date", { ascending: true });
  if (programIds?.length) q = q.in("program_id", programIds);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return asRows<PcRecordingSession>(data);
}

export async function listMemberships(filter?: {
  email?: string;
  programIds?: string[];
}): Promise<PcMembership[]> {
  const supabase = getSupabase();
  let q = supabase.from("pc_memberships").select("*");
  if (filter?.email) q = q.eq("user_email", filter.email.toLowerCase());
  if (filter?.programIds?.length) q = q.in("program_id", filter.programIds);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return asRows<PcMembership>(data);
}

export async function unlockWorkOrder(id: string, actor_email?: string): Promise<PcWorkOrder> {
  return patchWorkOrder(
    id,
    { status: "未開始", prereq_status: "已解鎖", prereq_missing: null },
    actor_email
  );
}

type ServiceTemplate = {
  id: string;
  name: string;
  service_code: string | null;
  workorder_kind: string | null;
  creates_workorder: boolean;
  billing_unit: string | null;
  requires_review: boolean;
};

/**
 * 依節目 services JSON + 模板產生工單／前製（idempotency_key 防重；已存在則跳過）
 */
export async function generateFromServices(
  programId: string,
  actor_email?: string
): Promise<{ workOrders: number; preprodTasks: number }> {
  const supabase = getSupabase();
  const program = await getProgram(programId);
  if (!program) throw new Error("找不到節目");
  const episodes = await listEpisodes([programId]);
  const { data: tmplData, error: tmplErr } = await supabase
    .from("pc_service_templates")
    .select("*")
    .eq("active", true);
  if (tmplErr) throw new Error(tmplErr.message);
  const templates = asRows<ServiceTemplate>(tmplData);
  const services = program.services ?? {};
  const serviceCodes = Object.keys(services);
  if (!serviceCodes.length) throw new Error("節目尚未設定 services");

  let woCount = 0;
  let pptCount = 0;

  for (const code of serviceCodes) {
    const tmpl = templates.find((t) => t.service_code === code || t.id === code);
    if (!tmpl) continue;
    const isProgramUnit = String(tmpl.billing_unit ?? "").includes("節目");
    const targets = isProgramUnit
      ? [{ episodeId: null as string | null, label: "" }]
      : episodes.map((ep) => ({ episodeId: ep.id as string | null, label: ep.label }));

    for (const target of targets) {
      if (tmpl.workorder_kind === "PRE_PRODUCTION" || code.startsWith("PLAN_")) {
        const idem = `${programId}|${target.episodeId ?? ""}|${tmpl.name}|1`;
        const { error } = await supabase.from("pc_preprod_tasks").insert({
          id: newId("PPT"),
          program_id: programId,
          episode_id: target.episodeId,
          scope: target.episodeId ? "EPISODE" : "PROGRAM",
          task_type: tmpl.name,
          service_code: tmpl.service_code,
          status: "未開始",
          idempotency_key: idem,
        });
        if (!error) pptCount += 1;
        // unique conflict → skip
      }

      if (tmpl.creates_workorder !== false) {
        const idem = `${target.episodeId ?? programId}|${tmpl.name}|1`;
        const { error } = await supabase.from("pc_work_orders").insert({
          id: newId("WO"),
          program_id: programId,
          episode_id: target.episodeId,
          service_name: tmpl.name,
          service_code: tmpl.service_code,
          unit_seq: 1,
          workorder_kind: tmpl.workorder_kind ?? "POST_PRODUCTION",
          status: "等待前置",
          prereq_status: "等待前置",
          client_billable: true,
          vendor_payable: false,
          is_program_singleton: isProgramUnit,
          singleton_key: isProgramUnit ? tmpl.service_code : null,
          included_revisions: program.included_revisions ?? 2,
          review_status: tmpl.requires_review ? "未送審" : "未送審",
          idempotency_key: idem,
        });
        if (!error) woCount += 1;
      }
    }
  }

  await logPcAction({
    action_type: "依服務產生工單",
    actor_email,
    program_id: programId,
    entity_type: "pc_programs",
    entity_id: programId,
    status: "成功",
    note: `wo=${woCount},ppt=${pptCount}`,
  });
  return { workOrders: woCount, preprodTasks: pptCount };
}
