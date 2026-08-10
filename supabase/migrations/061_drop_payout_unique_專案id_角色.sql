-- 實際唯一索引名為 idx_分潤表_專案id_角色（id 小寫），會擋住同一專案第二筆「額外獎金」
-- 060 只清了錯誤大小寫的名稱；此處用 pattern 再清一次。

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = '分潤表'
      AND (
        indexname ILIKE '%專案%角色%'
        OR indexname ILIKE '%專案%分潤類型%'
        OR indexdef ILIKE '%UNIQUE%分潤類型%'
        OR indexdef ILIKE '%UNIQUE%"角色"%'
      )
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS public.%I', r.indexname);
    RAISE NOTICE 'dropped index %', r.indexname;
  END LOOP;
END $$;
