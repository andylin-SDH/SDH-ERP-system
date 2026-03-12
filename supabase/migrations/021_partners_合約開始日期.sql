-- partners 表新增欄位：合約開始日期（text，與其他日期欄位一致可存 yyyy-MM-dd 或自由文字）
ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS "合約開始日期" text;

COMMENT ON COLUMN public.partners."合約開始日期" IS 'KOL 合約開始日期';
