-- 系統設定 key-value，供 分潤成數、專案類型、角色區塊 等可於前端調整
CREATE TABLE IF NOT EXISTS "system_config" (
  "key" text PRIMARY KEY,
  "value" jsonb NOT NULL DEFAULT '{}',
  "updated_at" timestamptz DEFAULT now()
);

COMMENT ON TABLE "system_config" IS '系統設定 key-value，覆寫 config 預設';
