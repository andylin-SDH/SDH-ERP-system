-- 移除專案表：專案資料改由大總表提供，不再維護獨立專案表
-- 1. 移除 009 建立的 trigger 與 function
-- 2. DROP 專案 表

-- ========== 1. 移除 trigger ==========
DROP TRIGGER IF EXISTS trg_大總表_after_insert_to_專案 ON "大總表";
DROP TRIGGER IF EXISTS trg_sync_專案狀態_大總表_to_專案 ON "大總表";
DROP TRIGGER IF EXISTS trg_sync_專案狀態_專案_to_大總表 ON "專案";

-- ========== 2. 移除 function ==========
DROP FUNCTION IF EXISTS fn_大總表_after_insert_to_專案();
DROP FUNCTION IF EXISTS fn_sync_專案狀態_大總表_to_專案();
DROP FUNCTION IF EXISTS fn_sync_專案狀態_專案_to_大總表();

-- ========== 3. DROP 專案 表 ==========
DROP TABLE IF EXISTS "專案" CASCADE;
