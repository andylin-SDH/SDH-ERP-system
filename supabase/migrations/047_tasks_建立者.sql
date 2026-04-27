ALTER TABLE public."任務" ADD COLUMN IF NOT EXISTS "建立者" text;

COMMENT ON COLUMN public."任務"."建立者" IS '建立任務的使用者姓名或 Email；系統排程建立時為系統排程';
