-- 大總表：新增 專案BDPM分潤成數 欄位（若不存在）
ALTER TABLE "大總表" ADD COLUMN IF NOT EXISTS "專案BDPM分潤成數" text;
