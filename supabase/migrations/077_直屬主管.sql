-- 員工的直屬主管，以及新專案開立時抄上去的快照。不回填舊專案、不改已入帳分潤。
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "直屬主管" text;
COMMENT ON COLUMN public.users."直屬主管" IS '這位員工的直屬主管（姓名）。只影響之後新開的專案。';

ALTER TABLE public."大總表" ADD COLUMN IF NOT EXISTS "直屬主管" text;
ALTER TABLE public."大總表" ADD COLUMN IF NOT EXISTS "直屬主管分潤成數" text;
COMMENT ON COLUMN public."大總表"."直屬主管" IS '開案當下，執行PM 的直屬主管。之後換主管不改這欄。';
COMMENT ON COLUMN public."大總表"."直屬主管分潤成數" IS '新專案預設 2.5%。舊專案留空，重算時不補成數。';
