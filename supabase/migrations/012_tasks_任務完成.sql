-- 任務表：新增 任務完成 欄位（boolean，預設 false）
ALTER TABLE "任務" ADD COLUMN IF NOT EXISTS "任務完成" boolean DEFAULT false;
