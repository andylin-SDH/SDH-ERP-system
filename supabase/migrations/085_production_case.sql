-- =============================================================================
-- 製作案（production case）獨立表：只新增，不改既有業務表／資料
-- 對齊 sdh-production-case-to-erp DATA_DICTIONARY／Gate1 schema（精簡可測 V1）
-- =============================================================================

-- 節目主檔
CREATE TABLE IF NOT EXISTS public.pc_programs (
  id text PRIMARY KEY,
  name text NOT NULL,
  client_name text,
  customer_id text,
  quotation_id text,
  source_mode text NOT NULL DEFAULT 'ERP_NATIVE',
  workflow_version text NOT NULL DEFAULT 'V2_FULL_LIFECYCLE',
  workflow_stage text NOT NULL DEFAULT '待開案',
  status text NOT NULL DEFAULT '進行中',
  pm_email text,
  pm_name text,
  total_episodes int,
  first_air_date date,
  frequency text,
  services jsonb NOT NULL DEFAULT '{}'::jsonb,
  included_revisions int DEFAULT 2,
  guest_invite_responsibility text,
  onboarding_due_date date,
  production_completed_at timestamptz,
  client_accepted_at timestamptz,
  finance_settled_at timestamptz,
  closed_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);
CREATE INDEX IF NOT EXISTS idx_pc_programs_stage ON public.pc_programs (workflow_stage);
CREATE INDEX IF NOT EXISTS idx_pc_programs_pm ON public.pc_programs (pm_email);

-- 單集
CREATE TABLE IF NOT EXISTS public.pc_episodes (
  id text PRIMARY KEY,
  program_id text NOT NULL REFERENCES public.pc_programs(id) ON DELETE CASCADE,
  season int DEFAULT 1,
  episode_no int NOT NULL,
  label text NOT NULL,
  title text,
  air_date date,
  recording_date date,
  topic text,
  topic_status text DEFAULT '未定',
  status text NOT NULL DEFAULT '預排',
  source_file text,
  material_status text DEFAULT '未交接',
  guest_requirement text DEFAULT '待確認',
  manual_lock boolean NOT NULL DEFAULT false,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  UNIQUE (program_id, label)
);
CREATE INDEX IF NOT EXISTS idx_pc_episodes_program ON public.pc_episodes (program_id);

-- 前製任務
CREATE TABLE IF NOT EXISTS public.pc_preprod_tasks (
  id text PRIMARY KEY,
  program_id text NOT NULL REFERENCES public.pc_programs(id) ON DELETE CASCADE,
  episode_id text REFERENCES public.pc_episodes(id) ON DELETE SET NULL,
  scope text NOT NULL DEFAULT 'EPISODE',
  task_type text NOT NULL,
  service_code text,
  assignee_email text,
  assignee_name text,
  due_date date,
  status text NOT NULL DEFAULT '未開始',
  deliverable_url text,
  revision_round int NOT NULL DEFAULT 0,
  blocked_reason text,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_pc_preprod_program ON public.pc_preprod_tasks (program_id);

-- 工單
CREATE TABLE IF NOT EXISTS public.pc_work_orders (
  id text PRIMARY KEY,
  program_id text NOT NULL REFERENCES public.pc_programs(id) ON DELETE CASCADE,
  episode_id text REFERENCES public.pc_episodes(id) ON DELETE SET NULL,
  service_name text NOT NULL,
  service_code text,
  unit_seq int NOT NULL DEFAULT 1,
  workorder_kind text DEFAULT 'POST_PRODUCTION',
  assignee_email text,
  assignee_name text,
  due_date date,
  due_anchor text,
  status text NOT NULL DEFAULT '等待前置',
  prereq_status text DEFAULT '等待前置',
  prereq_missing text,
  client_billable boolean NOT NULL DEFAULT true,
  vendor_payable boolean NOT NULL DEFAULT false,
  client_amount numeric,
  vendor_amount numeric,
  included_in_service text,
  parent_key text,
  is_program_singleton boolean NOT NULL DEFAULT false,
  singleton_key text,
  included_revisions int DEFAULT 2,
  revision_round int NOT NULL DEFAULT 0,
  client_approval_required boolean NOT NULL DEFAULT false,
  review_status text DEFAULT '未送審',
  overdue_eligible boolean NOT NULL DEFAULT true,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_pc_wo_program ON public.pc_work_orders (program_id);
CREATE INDEX IF NOT EXISTS idx_pc_wo_assignee ON public.pc_work_orders (assignee_email);
CREATE INDEX IF NOT EXISTS idx_pc_wo_status ON public.pc_work_orders (status);

-- 交付版本（只新增，不覆蓋）
CREATE TABLE IF NOT EXISTS public.pc_work_order_deliveries (
  id text PRIMARY KEY,
  workorder_id text NOT NULL REFERENCES public.pc_work_orders(id) ON DELETE CASCADE,
  delivery_seq int NOT NULL,
  delivery_url text,
  delivery_note text,
  submitted_by text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  is_current boolean NOT NULL DEFAULT true,
  UNIQUE (workorder_id, delivery_seq)
);

-- 審核紀錄
CREATE TABLE IF NOT EXISTS public.pc_work_order_reviews (
  id text PRIMARY KEY,
  workorder_id text NOT NULL REFERENCES public.pc_work_orders(id) ON DELETE CASCADE,
  delivery_id text REFERENCES public.pc_work_order_deliveries(id) ON DELETE SET NULL,
  revision_round int NOT NULL DEFAULT 0,
  reviewer_email text,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  result text NOT NULL,
  reject_reason text,
  fix_due_date date
);

-- 上架檢核
CREATE TABLE IF NOT EXISTS public.pc_upload_checklist (
  id text PRIMARY KEY,
  episode_id text NOT NULL REFERENCES public.pc_episodes(id) ON DELETE CASCADE,
  program_id text NOT NULL REFERENCES public.pc_programs(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT '未準備',
  final_audio_url text,
  shownotes_url text,
  cover_url text,
  final_video_url text,
  short_video_url text,
  title_confirmed boolean DEFAULT false,
  platform_name text,
  upload_note text,
  uploaded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (episode_id)
);

-- 錄音場次
CREATE TABLE IF NOT EXISTS public.pc_recording_sessions (
  id text PRIMARY KEY,
  program_id text NOT NULL REFERENCES public.pc_programs(id) ON DELETE CASCADE,
  session_date date,
  start_time text,
  end_time text,
  location_type text DEFAULT '實體',
  studio_name text,
  status text NOT NULL DEFAULT '暫定',
  host_confirmed boolean DEFAULT false,
  guest_confirmed boolean DEFAULT false,
  studio_confirmed boolean DEFAULT false,
  raw_file_location text,
  cancel_reason text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pc_episode_recording_links (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES public.pc_recording_sessions(id) ON DELETE CASCADE,
  episode_id text NOT NULL REFERENCES public.pc_episodes(id) ON DELETE CASCADE,
  link_type text NOT NULL DEFAULT '主錄',
  UNIQUE (session_id, episode_id, link_type)
);

-- 來賓
CREATE TABLE IF NOT EXISTS public.pc_guests (
  id text PRIMARY KEY,
  name text NOT NULL,
  organization text,
  title text,
  contact_window text,
  intro text,
  asset_url text,
  note text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pc_episode_guests (
  id text PRIMARY KEY,
  episode_id text NOT NULL REFERENCES public.pc_episodes(id) ON DELETE CASCADE,
  guest_id text REFERENCES public.pc_guests(id) ON DELETE SET NULL,
  invite_status text NOT NULL DEFAULT '待確認',
  invite_responsibility text,
  inviter_email text,
  invited_at timestamptz,
  responded_at timestamptz,
  decline_reason text,
  UNIQUE (episode_id, guest_id)
);

-- 服務模板
CREATE TABLE IF NOT EXISTS public.pc_service_templates (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  service_code text,
  billing_unit text,
  default_lead_days int DEFAULT 3,
  default_qty_per_episode int DEFAULT 1,
  workorder_kind text DEFAULT 'POST_PRODUCTION',
  creates_workorder boolean NOT NULL DEFAULT true,
  requires_review boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true
);

-- 節目成員（多角色）
CREATE TABLE IF NOT EXISTS public.pc_memberships (
  id text PRIMARY KEY,
  program_id text NOT NULL REFERENCES public.pc_programs(id) ON DELETE CASCADE,
  user_email text NOT NULL,
  member_role text NOT NULL,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_id, user_email, member_role)
);
CREATE INDEX IF NOT EXISTS idx_pc_memberships_email ON public.pc_memberships (user_email);

-- 操作稽核
CREATE TABLE IF NOT EXISTS public.pc_operation_logs (
  id bigserial PRIMARY KEY,
  action_type text NOT NULL,
  actor_email text,
  program_id text,
  entity_type text,
  entity_id text,
  status text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Seed：服務模板
-- ---------------------------------------------------------------------------
INSERT INTO public.pc_service_templates (id, name, service_code, billing_unit, default_lead_days, workorder_kind, requires_review)
VALUES
  ('ST-audio', '音檔剪輯', 'AUDIO_EDIT', '每集', 5, 'POST_PRODUCTION', false),
  ('ST-long', '長影剪輯', 'LONG_VIDEO_EDIT', '每集', 4, 'POST_PRODUCTION', false),
  ('ST-short', '短影剪輯', 'SHORT_VIDEO_EDIT', '每集', 3, 'POST_PRODUCTION', true),
  ('ST-short-script', '短影腳本', 'SHORT_SCRIPT', '每集', 6, 'PRE_PRODUCTION', false),
  ('ST-upload', '上架', 'PUBLISH', '每集', 1, 'PUBLISHING', false),
  ('ST-cover', '封面設計', 'COVER_PACKAGE', '節目', 10, 'PRE_PRODUCTION', true),
  ('ST-intro', '片頭曲製作', 'INTRO_PACKAGE', '節目', 10, 'PRE_PRODUCTION', false),
  ('ST-outline', '訪綱企劃', 'PLAN_INTERVIEW_OUTLINE', '每集', 2, 'PRE_PRODUCTION', true),
  ('ST-shownotes', '資訊欄撰寫', 'SHOWNOTES', '每集', 2, 'POST_PRODUCTION', false),
  ('ST-social', '社群文案', 'PLAN_SOCIAL_COPY', '每集', 2, 'POST_PRODUCTION', false)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Seed：示範節目／集／工單／成員（可重複執行；帳號請另用 seed 腳本寫入 users）
-- ---------------------------------------------------------------------------
INSERT INTO public.pc_programs (
  id, name, client_name, source_mode, workflow_version, workflow_stage, status,
  pm_email, pm_name, total_episodes, first_air_date, frequency, services, included_revisions, note
) VALUES (
  'PC-DEMO-01',
  '示範節目《週一聊聊》',
  '示範客戶 A',
  'ERP_NATIVE',
  'V2_FULL_LIFECYCLE',
  '後製中',
  '進行中',
  'pc-pm@sdh-uat.test',
  '測試PM',
  4,
  '2026-11-01',
  '每週',
  '{"AUDIO_EDIT":{"quantity":4},"SHORT_VIDEO_EDIT":{"quantity":4},"PLAN_INTERVIEW_OUTLINE":{"quantity":4},"COVER_PACKAGE":{"quantity":1},"SHOWNOTES":{"quantity":4}}'::jsonb,
  2,
  'UAT 示範案'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pc_episodes (id, program_id, season, episode_no, label, title, air_date, recording_date, topic_status, status) VALUES
  ('PC-EP-01-01', 'PC-DEMO-01', 1, 1, '1-1', '第1集｜開場怎麼聊', '2026-11-10', '2026-11-05', '已確認', '後製中'),
  ('PC-EP-01-02', 'PC-DEMO-01', 1, 2, '1-2', '第2集｜來賓特輯', '2026-11-17', '2026-11-12', '已確認', '已錄音'),
  ('PC-EP-01-03', 'PC-DEMO-01', 1, 3, '1-3', '第3集｜產品故事', '2026-11-24', '2026-11-26', '已確認', '錄音已排'),
  ('PC-EP-01-04', 'PC-DEMO-01', 1, 4, '1-4', '第4集｜年底回顧', '2026-12-01', NULL, '暫定', '主題確認')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pc_preprod_tasks (id, program_id, episode_id, scope, task_type, assignee_email, assignee_name, due_date, status, idempotency_key) VALUES
  ('PC-PPT-01', 'PC-DEMO-01', 'PC-EP-01-01', 'EPISODE', '訪綱企劃', 'pc-pm@sdh-uat.test', '測試PM', '2026-11-01', '已完成', 'PC-DEMO-01|PC-EP-01-01|訪綱企劃|1'),
  ('PC-PPT-02', 'PC-DEMO-01', 'PC-EP-01-04', 'EPISODE', '訪綱企劃', 'pc-pm@sdh-uat.test', '測試PM', '2026-11-22', '等待來賓', 'PC-DEMO-01|PC-EP-01-04|訪綱企劃|1'),
  ('PC-PPT-03', 'PC-DEMO-01', NULL, 'PROGRAM', '視覺品牌', 'pc-pm@sdh-uat.test', '測試PM', '2026-10-28', '已完成', 'PC-DEMO-01||視覺品牌|1')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pc_work_orders (
  id, program_id, episode_id, service_name, service_code, unit_seq, workorder_kind,
  assignee_email, assignee_name, due_date, status, prereq_status, prereq_missing,
  client_billable, vendor_payable, client_amount, vendor_amount,
  included_revisions, revision_round, review_status, idempotency_key
) VALUES
  ('PC-WO-01', 'PC-DEMO-01', 'PC-EP-01-01', '音檔剪輯', 'AUDIO_EDIT', 1, 'POST_PRODUCTION',
   'pc-vendor@sdh-uat.test', '測試外包', '2026-11-18', '待審核', '已解鎖', NULL,
   true, true, 3500, 2200, 2, 0, '未送審', 'PC-EP-01-01|音檔剪輯|1'),
  ('PC-WO-02', 'PC-DEMO-01', 'PC-EP-01-01', '資訊欄撰寫', 'SHOWNOTES', 1, 'POST_PRODUCTION',
   'pc-vendor@sdh-uat.test', '測試外包', '2026-11-19', '進行中', '已解鎖', NULL,
   true, true, 800, 500, 1, 0, '未送審', 'PC-EP-01-01|資訊欄撰寫|1'),
  ('PC-WO-03', 'PC-DEMO-01', 'PC-EP-01-02', '音檔剪輯', 'AUDIO_EDIT', 1, 'POST_PRODUCTION',
   'pc-vendor@sdh-uat.test', '測試外包', '2026-11-20', '等待前置', '等待前置', '音檔尚未交接',
   true, true, 3500, 2200, 2, 0, '未送審', 'PC-EP-01-02|音檔剪輯|1'),
  ('PC-WO-04', 'PC-DEMO-01', 'PC-EP-01-01', '短影剪輯', 'SHORT_VIDEO_EDIT', 1, 'POST_PRODUCTION',
   'pc-vendor@sdh-uat.test', '測試外包', '2026-11-17', '需修改', '已解鎖', NULL,
   true, true, 2500, 1600, 2, 2, '未送審', 'PC-EP-01-01|短影剪輯|1'),
  ('PC-WO-05', 'PC-DEMO-01', NULL, '封面設計', 'COVER_PACKAGE', 1, 'PRE_PRODUCTION',
   'pc-vendor@sdh-uat.test', '測試外包', '2026-10-28', '已完成', '已解鎖', NULL,
   true, true, 6000, 4000, 2, 1, '通過', 'PC-DEMO-01|封面設計|1')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pc_upload_checklist (id, episode_id, program_id, status) VALUES
  ('PC-UP-01', 'PC-EP-01-01', 'PC-DEMO-01', '備妥中'),
  ('PC-UP-02', 'PC-EP-01-02', 'PC-DEMO-01', '未準備')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pc_recording_sessions (id, program_id, session_date, start_time, end_time, studio_name, status) VALUES
  ('PC-RS-01', 'PC-DEMO-01', '2026-11-05', '10:00', '12:00', '大錄音室', '已完成'),
  ('PC-RS-02', 'PC-DEMO-01', '2026-11-12', '14:00', '16:00', '小錄音室', '已完成'),
  ('PC-RS-03', 'PC-DEMO-01', '2026-11-26', '10:00', '12:00', '大錄音室', '已確認')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pc_episode_recording_links (id, session_id, episode_id, link_type) VALUES
  ('PC-ERL-01', 'PC-RS-01', 'PC-EP-01-01', '主錄'),
  ('PC-ERL-02', 'PC-RS-02', 'PC-EP-01-02', '主錄'),
  ('PC-ERL-03', 'PC-RS-03', 'PC-EP-01-03', '主錄')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pc_memberships (id, program_id, user_email, member_role, display_name) VALUES
  ('PC-MEM-01', 'PC-DEMO-01', 'pc-pm@sdh-uat.test', 'PM', '測試PM'),
  ('PC-MEM-02', 'PC-DEMO-01', 'pc-vendor@sdh-uat.test', '外包', '測試外包'),
  ('PC-MEM-03', 'PC-DEMO-01', 'pc-client@sdh-uat.test', '案主', '測試案主'),
  ('PC-MEM-04', 'PC-DEMO-01', 'pc-kol@sdh-uat.test', 'KOL', '測試KOL')
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.pc_programs IS '製作案節目主檔（獨立模組，不連大總表）';
COMMENT ON TABLE public.pc_work_orders IS '製作案工單；交付歷史見 pc_work_order_deliveries';
COMMENT ON TABLE public.pc_memberships IS '製作案節目成員角色（PM／外包／案主／KOL）';
