-- KOL 審核流程：待審核 → 董事長核准後才出現在主列表
-- 既有列一律視為已核准，避免列表突然變空

ALTER TABLE public.partners ADD COLUMN IF NOT EXISTS "審核狀態" text DEFAULT '已核准';
ALTER TABLE public.partners ADD COLUMN IF NOT EXISTS "建立者" text;
ALTER TABLE public.partners ADD COLUMN IF NOT EXISTS "駁回理由" text;

-- 舊資料若已寫入 NULL，補成已核准
UPDATE public.partners SET "審核狀態" = '已核准' WHERE "審核狀態" IS NULL OR trim("審核狀態") = '';

COMMENT ON COLUMN public.partners."審核狀態" IS '待審核 | 已核准 | 已駁回；主列表只顯示已核准';
COMMENT ON COLUMN public.partners."建立者" IS '送出申請的使用者 email，供待審核列表篩選';
COMMENT ON COLUMN public.partners."駁回理由" IS '董事長駁回時填寫，經紀人可於待審核列表查看';
