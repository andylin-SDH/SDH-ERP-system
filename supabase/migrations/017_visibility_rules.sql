-- 資料可見規則：當資料的「某欄位」符合登入者姓名/Email 時，顯示該列
-- 取代 scope，可彈性設定多個欄位條件（OR 邏輯）
CREATE TABLE IF NOT EXISTS "visibility_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "table_key" text NOT NULL UNIQUE,
  "match_fields" text[] DEFAULT '{}',
  "updated_at" timestamptz DEFAULT now()
);

COMMENT ON TABLE "visibility_rules" IS '各 Table 的「符合即顯示」欄位；例如 master 的 專案BDPM、執行管理員';
INSERT INTO "visibility_rules" ("table_key", "match_fields")
VALUES
  ('master', ARRAY['專案BDPM', '執行管理員', '專案引薦人', '專案管理員']),
  ('partners', ARRAY['負責經紀人']),
  ('tasks', ARRAY['任務負責人'])
ON CONFLICT ("table_key") DO NOTHING;
