-- 分潤表新增日期欄位：
-- 1) 專案入帳日期
-- 2) 分潤匯款日期
ALTER TABLE "分潤表"
  ADD COLUMN IF NOT EXISTS "專案入帳日期" text,
  ADD COLUMN IF NOT EXISTS "分潤匯款日期" text;
