-- 大總表：模式 B（廣告業配、團購）之「主管／KOL開發者」改為專案層手填
ALTER TABLE public."大總表"
  ADD COLUMN IF NOT EXISTS "主管" text,
  ADD COLUMN IF NOT EXISTS "KOL開發者" text;

COMMENT ON COLUMN public."大總表"."主管" IS '廣告業配／團購：主管（專案手填；選 KOL 時可預填合作夥伴值）';
COMMENT ON COLUMN public."大總表"."KOL開發者" IS '廣告業配／團購：KOL引薦人（專案手填；選 KOL 時可預填合作夥伴值）';

-- 既有廣告業配／團購：依 KOL 名稱自 partners 帶入
UPDATE public."大總表" m
SET
  "主管" = COALESCE(NULLIF(trim(m."主管"), ''), NULLIF(trim(p."主管"), '')),
  "KOL開發者" = COALESCE(NULLIF(trim(m."KOL開發者"), ''), NULLIF(trim(p."KOL開發者"), ''))
FROM public.partners p
WHERE m."專案類型" IN ('廣告業配', '團購')
  AND m."KOL名稱" IS NOT NULL
  AND trim(m."KOL名稱") = trim(p."合作夥伴名稱");

-- ② 資料可見：若已勾選 經紀人，一併加入 主管／KOL開發者
UPDATE public."visibility_rules"
SET
  "match_fields" = "match_fields" || ARRAY['主管', 'KOL開發者']::text[],
  "updated_at" = now()
WHERE "table_key" = 'master'
  AND '經紀人' = ANY ("match_fields")
  AND NOT ('主管' = ANY ("match_fields"));
