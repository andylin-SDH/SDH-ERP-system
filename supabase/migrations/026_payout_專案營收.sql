-- 分潤表 新增欄位：專案營收（來自大總表）
ALTER TABLE "分潤表"
  ADD COLUMN IF NOT EXISTS "專案營收" text;

