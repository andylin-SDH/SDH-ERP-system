-- 補開 public 裡尚未啟用資料列安全性的表。
-- 不新增政策：anon / authenticated 讀寫不到。
-- 伺服器使用 service_role，不受影響。不改、不刪既有資料。
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
