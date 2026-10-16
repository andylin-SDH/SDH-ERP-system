-- 大總表：廠商統一編號（開立發票買受人統編可直接帶入）
ALTER TABLE public."大總表"
  ADD COLUMN IF NOT EXISTS "統一編號" text;
