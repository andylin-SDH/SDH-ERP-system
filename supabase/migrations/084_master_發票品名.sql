-- 大總表：發票品名（開立發票時帶入明細品名。空白則仍用專案名稱）
ALTER TABLE public."大總表"
  ADD COLUMN IF NOT EXISTS "發票品名" text;
