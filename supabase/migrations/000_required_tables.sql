-- =============================================================================
-- SDH ERP 所需全部表（一次性建立，補齊漏掉的 migration）
-- 請在 Supabase Dashboard > SQL Editor 執行此檔
-- 若表已存在會跳過（CREATE TABLE IF NOT EXISTS）
-- =============================================================================

-- 1. visibility_rules：資料可見規則（② 勾選欄位符合登入者姓名/Email 時顯示該列）
CREATE TABLE IF NOT EXISTS "visibility_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "table_key" text NOT NULL UNIQUE,
  "match_fields" text[] DEFAULT '{}',
  "updated_at" timestamptz DEFAULT now()
);
COMMENT ON TABLE "visibility_rules" IS '各 Table 的「符合即顯示」欄位';
INSERT INTO "visibility_rules" ("table_key", "match_fields")
VALUES
  ('master', ARRAY['專案BDPM', '執行管理員', '專案引薦人', '專案管理員']),
  ('partners', ARRAY[]::text[]),
  ('tasks', ARRAY['任務負責人']),
  ('payout', ARRAY['領取人'])
ON CONFLICT ("table_key") DO NOTHING;

-- 2. user_visibility：使用者可見範圍（③ 每位使用者可看到的 Table 與欄位）
CREATE TABLE IF NOT EXISTS "user_visibility" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_email" text NOT NULL UNIQUE,
  "tables" text[] DEFAULT '{}',
  "columns" jsonb DEFAULT '{}',
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);
COMMENT ON TABLE "user_visibility" IS '每位使用者可看到的 Table 與欄位';
CREATE INDEX IF NOT EXISTS idx_user_visibility_user_email ON "user_visibility"("user_email");

-- 3. system_config：系統設定（① 角色可見區塊、分潤成數、專案類型）
CREATE TABLE IF NOT EXISTS "system_config" (
  "key" text PRIMARY KEY,
  "value" jsonb NOT NULL DEFAULT '{}',
  "updated_at" timestamptz DEFAULT now()
);
COMMENT ON TABLE "system_config" IS '系統設定 key-value';

-- 4. partners：合作夥伴 / KOL（程式碼 .from("partners")）
CREATE TABLE IF NOT EXISTS "partners" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "partner_id" text,
  "partner_name" text,
  "partner_type" text,
  "partner_emails" text,
  "responsible_agent" text,
  "notes" text,
  "created_at" timestamptz DEFAULT now()
);
COMMENT ON TABLE "partners" IS '合作夥伴 / KOL';
CREATE INDEX IF NOT EXISTS idx_partners_partner_id ON "partners"("partner_id");
CREATE INDEX IF NOT EXISTS idx_partners_responsible_agent ON "partners"("responsible_agent");

-- 5. invoices：發票（API /api/invoices）
CREATE TABLE IF NOT EXISTS "invoices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" text,
  "invoice_no" text,
  "amount" text,
  "status" text,
  "issue_date" text,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);
COMMENT ON TABLE "invoices" IS '發票';
CREATE INDEX IF NOT EXISTS idx_invoices_project_id ON "invoices"("project_id");

-- 6. finance：財務（API /api/finance）
CREATE TABLE IF NOT EXISTS "finance" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);
COMMENT ON TABLE "finance" IS '財務';
