-- KOL 勞報身分證正反面影本：存 partners（填一次帶出）；批次／專案列可快照

ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS "勞報身分證正面" text,
  ADD COLUMN IF NOT EXISTS "勞報身分證反面" text;

COMMENT ON COLUMN public.partners."勞報身分證正面" IS 'KOL 身分證正面影本 URL；首次上傳後自動帶入';
COMMENT ON COLUMN public.partners."勞報身分證反面" IS 'KOL 身分證反面影本 URL；首次上傳後自動帶入';

ALTER TABLE public."KOL請款批次"
  ADD COLUMN IF NOT EXISTS "勞報身分證正面" text,
  ADD COLUMN IF NOT EXISTS "勞報身分證反面" text;

COMMENT ON COLUMN public."KOL請款批次"."勞報身分證正面" IS '該批次提領當下的身分證正面影本 URL';
COMMENT ON COLUMN public."KOL請款批次"."勞報身分證反面" IS '該批次提領當下的身分證反面影本 URL';

ALTER TABLE public."KOL發票"
  ADD COLUMN IF NOT EXISTS "勞報身分證正面" text,
  ADD COLUMN IF NOT EXISTS "勞報身分證反面" text;

COMMENT ON COLUMN public."KOL發票"."勞報身分證正面" IS '該筆勞報身分證正面影本 URL';
COMMENT ON COLUMN public."KOL發票"."勞報身分證反面" IS '該筆勞報身分證反面影本 URL';
