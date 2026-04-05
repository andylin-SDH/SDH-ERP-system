-- 廢除「合約開始日期」，改以「經銷約開始日」為唯一開始日欄位（資料合併後刪除舊欄）
ALTER TABLE public.partners ADD COLUMN IF NOT EXISTS "經銷約開始日" text;

UPDATE public.partners
SET "經銷約開始日" = COALESCE(
  NULLIF(TRIM("經銷約開始日"), ''),
  NULLIF(TRIM("合約開始日期"), '')
);

ALTER TABLE public.partners DROP COLUMN IF EXISTS "合約開始日期";

COMMENT ON COLUMN public.partners."經銷約開始日" IS '經銷約開始日（建議 yyyy-MM-dd）';
