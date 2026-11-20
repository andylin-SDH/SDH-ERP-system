/** 製作案型別 — 對齊 pc_* 表與狀態機 */

export const PROGRAM_STAGES = [
  "待開案",
  "待案主填寫",
  "開案審核中",
  "前製中",
  "錄音排程中",
  "錄製中",
  "後製中",
  "待上架",
  "上架中",
  "製作完成",
  "待財務結清",
  "已結案",
] as const;
export type ProgramStage = (typeof PROGRAM_STAGES)[number];

export const EPISODE_STATUSES = [
  "預排",
  "主題確認",
  "企劃完成",
  "錄音已排",
  "已錄音",
  "後製中",
  "待審核",
  "修改中",
  "審核通過",
  "待上架",
  "已上架",
  "已完成",
] as const;
export type EpisodeStatus = (typeof EPISODE_STATUSES)[number];

export const WORK_ORDER_STATUSES = [
  "等待前置",
  "未開始",
  "進行中",
  "已送出",
  "待審核",
  "需修改",
  "已完成",
  "已請款",
  "已取消",
] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

export const PREPROD_STATUSES = [
  "未開始",
  "進行中",
  "等待客戶",
  "等待來賓",
  "待審核",
  "需修改",
  "已完成",
  "不適用",
  "已取消",
] as const;
export type PreprodStatus = (typeof PREPROD_STATUSES)[number];

export const PC_MEMBER_ROLES = ["PM", "外包", "案主", "KOL", "內部"] as const;
export type PcMemberRole = (typeof PC_MEMBER_ROLES)[number];

/** users.role 擴充：外包／製作案主（案主） */
export const PC_USER_ROLES = ["外包", "製作案主"] as const;

export type PcProgram = {
  id: string;
  name: string;
  client_name: string | null;
  source_mode: string;
  workflow_version: string;
  workflow_stage: ProgramStage | string;
  status: string;
  pm_email: string | null;
  pm_name: string | null;
  total_episodes: number | null;
  first_air_date: string | null;
  frequency: string | null;
  services: Record<string, unknown>;
  included_revisions: number | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type PcEpisode = {
  id: string;
  program_id: string;
  season: number | null;
  episode_no: number;
  label: string;
  title: string | null;
  air_date: string | null;
  recording_date: string | null;
  topic: string | null;
  topic_status: string | null;
  status: string;
  material_status: string | null;
};

export type PcPreprodTask = {
  id: string;
  program_id: string;
  episode_id: string | null;
  scope: string;
  task_type: string;
  assignee_email: string | null;
  assignee_name: string | null;
  due_date: string | null;
  status: string;
  deliverable_url: string | null;
  revision_round: number;
};

export type PcWorkOrder = {
  id: string;
  program_id: string;
  episode_id: string | null;
  service_name: string;
  service_code: string | null;
  unit_seq: number;
  workorder_kind: string | null;
  assignee_email: string | null;
  assignee_name: string | null;
  due_date: string | null;
  status: string;
  prereq_status: string | null;
  prereq_missing: string | null;
  client_billable: boolean;
  vendor_payable: boolean;
  client_amount: number | null;
  vendor_amount: number | null;
  included_revisions: number | null;
  revision_round: number;
  review_status: string | null;
};

export type PcDelivery = {
  id: string;
  workorder_id: string;
  delivery_seq: number;
  delivery_url: string | null;
  delivery_note: string | null;
  submitted_by: string | null;
  submitted_at: string;
  is_current: boolean;
};

export type PcUploadChecklist = {
  id: string;
  episode_id: string;
  program_id: string;
  status: string;
  final_audio_url: string | null;
  shownotes_url: string | null;
  cover_url: string | null;
  title_confirmed: boolean | null;
  upload_note: string | null;
};

export type PcRecordingSession = {
  id: string;
  program_id: string;
  session_date: string | null;
  start_time: string | null;
  end_time: string | null;
  studio_name: string | null;
  status: string;
};

export type PcMembership = {
  id: string;
  program_id: string;
  user_email: string;
  member_role: string;
  display_name: string | null;
};

export type PcPerspective = "internal" | "vendor" | "client" | "kol";

export type PcSnapshot = {
  programs: PcProgram[];
  episodes: PcEpisode[];
  preprodTasks: PcPreprodTask[];
  workOrders: PcWorkOrder[];
  deliveries: PcDelivery[];
  uploads: PcUploadChecklist[];
  sessions: PcRecordingSession[];
  memberships: PcMembership[];
  perspective: PcPerspective;
};
