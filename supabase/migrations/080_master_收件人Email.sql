-- 大總表：發票收件人 Email（開立發票買受人 Email 可直接帶入）
ALTER TABLE public."大總表"
  ADD COLUMN IF NOT EXISTS "收件人Email" text;
