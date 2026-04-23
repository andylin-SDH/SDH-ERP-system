-- 大總表：長期案旗標（每月/定期請款用）
ALTER TABLE public."大總表"
ADD COLUMN IF NOT EXISTS "長期案" boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public."大總表"."長期案" IS '是否為長期案（定期請款）';
