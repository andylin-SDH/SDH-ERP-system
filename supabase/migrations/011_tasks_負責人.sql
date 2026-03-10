-- 任務表：新增 負責人 欄位（若不存在）
ALTER TABLE "任務" ADD COLUMN IF NOT EXISTS "負責人" text;
