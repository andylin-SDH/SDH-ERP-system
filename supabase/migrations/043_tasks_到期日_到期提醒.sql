-- 任務到期日（使用者可填）；到期提醒寄送於 = 已寄送「即將／逾期」通知的時間，避免重複寄信
ALTER TABLE public."任務" ADD COLUMN IF NOT EXISTS "到期日" date;
ALTER TABLE public."任務" ADD COLUMN IF NOT EXISTS "到期提醒寄送於" timestamptz;

COMMENT ON COLUMN public."任務"."到期日" IS '任務預定完成日（YYYY-MM-DD）；供儀表板與即將到期通知';
COMMENT ON COLUMN public."任務"."到期提醒寄送於" IS '已寄送即將到期／逾期通知的時間；變更到期日或負責人時由 API 清空';
