-- KOL 形象照：公開 URL（存 Supabase Storage partner-avatars bucket）
ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS "形象照" text;

COMMENT ON COLUMN public.partners."形象照" IS 'KOL 正方形形象照公開 URL，供後台與對外網紅牆使用';
