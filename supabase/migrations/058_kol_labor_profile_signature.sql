-- KOL 勞報：個人資料存 partners（填一次）、每筆請款存電子簽名
ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS "勞報身分證字號" text,
  ADD COLUMN IF NOT EXISTS "勞報聯絡電話" text,
  ADD COLUMN IF NOT EXISTS "勞報戶籍地址" text;

COMMENT ON COLUMN public.partners."勞報身分證字號" IS 'KOL 勞務報酬用；首次填寫後自動帶入各專案';
COMMENT ON COLUMN public.partners."勞報聯絡電話" IS 'KOL 勞務報酬用；首次填寫後自動帶入';
COMMENT ON COLUMN public.partners."勞報戶籍地址" IS 'KOL 勞務報酬用；首次填寫後自動帶入';

ALTER TABLE public."KOL發票"
  ADD COLUMN IF NOT EXISTS "勞報簽名" text;

COMMENT ON COLUMN public."KOL發票"."勞報簽名" IS '該筆勞報之電子簽名（PNG data URL）；每筆請款各簽一次';
