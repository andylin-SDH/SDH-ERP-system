-- 大總表 與 專案 互相同步
-- 1. 大總表 新增 → 專案 自動新增一筆（專案ID、專案名稱、專案類型、開案日期、專案狀態、狀態確認日期、備註）
-- 2. 專案狀態 互通：大總表.專案狀態 ⇄ 專案.專案狀態（雙向同步，避免 trigger 迴圈）

-- ========== 1. 大總表 INSERT 時，自動在 專案 新增對應列 ==========
CREATE OR REPLACE FUNCTION fn_大總表_after_insert_to_專案()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO "專案" (
    "專案ID", "專案名稱", "專案類型", "專案狀態", "狀態確認日期", "開案日期", "備註", "created_at", "updated_at"
  ) VALUES (
    NEW."專案ID", NEW."專案名稱", NEW."專案類型", NEW."專案狀態", NEW."狀態確認日期", NEW."開案日期", NEW."備註", now(), now()
  )
  ON CONFLICT ("專案ID") DO UPDATE SET
    "專案名稱" = EXCLUDED."專案名稱",
    "專案類型" = EXCLUDED."專案類型",
    "專案狀態" = EXCLUDED."專案狀態",
    "狀態確認日期" = EXCLUDED."狀態確認日期",
    "開案日期" = EXCLUDED."開案日期",
    "備註" = EXCLUDED."備註",
    "updated_at" = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_大總表_after_insert_to_專案 ON "大總表";
CREATE TRIGGER trg_大總表_after_insert_to_專案
  AFTER INSERT ON "大總表"
  FOR EACH ROW
  EXECUTE FUNCTION fn_大總表_after_insert_to_專案();

-- ========== 2. 專案狀態 互通：大總表 → 專案 ==========
CREATE OR REPLACE FUNCTION fn_sync_專案狀態_大總表_to_專案()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('sync_專案狀態.in_progress', true) = '1' THEN
    RETURN NEW;
  END IF;
  IF OLD."專案狀態" IS NOT DISTINCT FROM NEW."專案狀態" THEN
    RETURN NEW;
  END IF;
  PERFORM set_config('sync_專案狀態.in_progress', '1', true);
  UPDATE "專案" SET "專案狀態" = NEW."專案狀態", "updated_at" = now() WHERE "專案ID" = NEW."專案ID";
  PERFORM set_config('sync_專案狀態.in_progress', '0', true);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_專案狀態_大總表_to_專案 ON "大總表";
CREATE TRIGGER trg_sync_專案狀態_大總表_to_專案
  AFTER UPDATE OF "專案狀態" ON "大總表"
  FOR EACH ROW
  WHEN (OLD."專案狀態" IS DISTINCT FROM NEW."專案狀態")
  EXECUTE FUNCTION fn_sync_專案狀態_大總表_to_專案();

-- ========== 3. 專案狀態 互通：專案 → 大總表 ==========
CREATE OR REPLACE FUNCTION fn_sync_專案狀態_專案_to_大總表()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('sync_專案狀態.in_progress', true) = '1' THEN
    RETURN NEW;
  END IF;
  IF OLD."專案狀態" IS NOT DISTINCT FROM NEW."專案狀態" THEN
    RETURN NEW;
  END IF;
  PERFORM set_config('sync_專案狀態.in_progress', '1', true);
  UPDATE "大總表" SET "專案狀態" = NEW."專案狀態", "updated_at" = now() WHERE "專案ID" = NEW."專案ID";
  PERFORM set_config('sync_專案狀態.in_progress', '0', true);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_專案狀態_專案_to_大總表 ON "專案";
CREATE TRIGGER trg_sync_專案狀態_專案_to_大總表
  AFTER UPDATE OF "專案狀態" ON "專案"
  FOR EACH ROW
  WHEN (OLD."專案狀態" IS DISTINCT FROM NEW."專案狀態")
  EXECUTE FUNCTION fn_sync_專案狀態_專案_to_大總表();
