-- partners 表新增欄位：KOL開發者（text，可空）
ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS "KOL開發者" text;

COMMENT ON COLUMN public.partners."KOL開發者" IS 'KOL 開發者';
