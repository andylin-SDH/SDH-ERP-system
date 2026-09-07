-- 合作夥伴／KOL 後台內部紀錄：報價（不對外前台顯示）
ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS "報價" text;

COMMENT ON COLUMN public.partners."報價" IS '後台內部報價紀錄，不供 KOL 牆／老師入口等前台顯示';
