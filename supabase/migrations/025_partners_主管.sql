-- partners 表新增欄位：主管（text，可空）
-- 分潤模式 B（廣告案）時，主管由 KOL 表帶出，大總表僅顯示
ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS "主管" text;

COMMENT ON COLUMN public.partners."主管" IS '主管（分潤模式 B 用）';
