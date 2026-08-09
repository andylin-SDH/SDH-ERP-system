-- 額外獎金：同一專案可有多筆「分潤類型＝額外獎金」（不同領取人）
-- 舊 schema 若存在 (專案ID, 角色／分潤類型) 唯一索引會擋住第二筆，於此移除。

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'idx_分潤表_專案ID_角色'
  ) THEN
    EXECUTE 'DROP INDEX IF EXISTS public."idx_分潤表_專案ID_角色"';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'idx_分潤表_專案ID_分潤類型'
  ) THEN
    EXECUTE 'DROP INDEX IF EXISTS public."idx_分潤表_專案ID_分潤類型"';
  END IF;
END $$;

COMMENT ON TABLE public."分潤表" IS '角色分潤（成數由大總表帶入）；分潤類型「額外獎金」為人工列，可多筆且重算時保留';
