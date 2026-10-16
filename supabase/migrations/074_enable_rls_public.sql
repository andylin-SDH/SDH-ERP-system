-- 公開資料表開啟資料列安全性。
-- 不新增政策：anon / authenticated 一律讀寫不到。
-- 本系統伺服器使用 service_role，不受此限制，既有資料不改、不刪。

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity = false
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname);
  END LOOP;
END $$;
