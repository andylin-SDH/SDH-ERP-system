-- 分潤表新增日期欄位：
-- 1) 專案預計匯款日
-- 2) 專案實際入帳日期
-- 3) 分潤匯款日期
ALTER TABLE "分潤表"
  ADD COLUMN IF NOT EXISTS "專案預計匯款日" text,
  ADD COLUMN IF NOT EXISTS "專案實際入帳日期" text,
  ADD COLUMN IF NOT EXISTS "分潤匯款日期" text;
