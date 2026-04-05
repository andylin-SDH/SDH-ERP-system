-- 經銷約開始日 整併至 合約開始日期（僅在合約開始日期為空時帶入經銷約開始日）
UPDATE public.partners
SET "合約開始日期" = TRIM("經銷約開始日")
WHERE COALESCE(TRIM("合約開始日期"), '') = ''
  AND COALESCE(TRIM("經銷約開始日"), '') <> '';

ALTER TABLE public.partners DROP COLUMN IF EXISTS "經銷約開始日";

COMMENT ON COLUMN public.partners."合約開始日期" IS 'KOL 合約／經銷約開始日（建議 yyyy-MM-dd）';
