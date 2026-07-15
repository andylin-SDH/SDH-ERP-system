-- KOL 請款：支援勞務報酬單（個人戶）
ALTER TABLE public."KOL發票"
  ADD COLUMN IF NOT EXISTS "請款方式" text,
  ADD COLUMN IF NOT EXISTS "勞務期間起" date,
  ADD COLUMN IF NOT EXISTS "勞務期間迄" date,
  ADD COLUMN IF NOT EXISTS "勞務內容" text,
  ADD COLUMN IF NOT EXISTS "給付總額" text,
  ADD COLUMN IF NOT EXISTS "身分證字號" text,
  ADD COLUMN IF NOT EXISTS "勞報簽署時間" timestamptz;

COMMENT ON COLUMN public."KOL發票"."請款方式" IS '發票｜勞務報酬；預設發票（公司戶）';
COMMENT ON COLUMN public."KOL發票"."勞報簽署時間" IS 'KOL 確認並送出勞務報酬單之時間';
