-- 使用者可見範圍設定（董事長可為每位使用者設定可見的 Table 與欄位）
CREATE TABLE IF NOT EXISTS "user_visibility" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_email" text NOT NULL UNIQUE,
  "tables" text[] DEFAULT '{}',
  "columns" jsonb DEFAULT '{}',
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);

COMMENT ON TABLE "user_visibility" IS '每位使用者可看到的 Table 與欄位；columns 格式 { "master": ["專案ID","專案名稱",...], "partners": ["*"] }';
CREATE INDEX IF NOT EXISTS idx_user_visibility_user_email ON "user_visibility"("user_email");
