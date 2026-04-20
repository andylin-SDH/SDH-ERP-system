-- 任務表：備註（自由文字，可選）
ALTER TABLE public."任務" ADD COLUMN IF NOT EXISTS "備註" text;

COMMENT ON COLUMN public."任務"."備註" IS '任務備註（使用者填寫）';
