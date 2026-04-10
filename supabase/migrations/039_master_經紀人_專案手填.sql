-- 大總表：模式 B（廣告業配）之「經紀人」改為專案層手填，不再僅由合作夥伴帶出
ALTER TABLE public."大總表" ADD COLUMN IF NOT EXISTS "經紀人" text;

COMMENT ON COLUMN public."大總表"."經紀人" IS '廣告業配專案：經紀人（手填）；主管／KOL開發者仍可由 KOL 合作夥伴帶出';
