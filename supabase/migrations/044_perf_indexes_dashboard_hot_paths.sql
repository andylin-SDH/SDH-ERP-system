-- Dashboard 熱路徑查詢索引（users session、財務/分潤/大總表依專案ID）
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'email'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_users_email ON public.users (email)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = '帳號'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_users_zh_account ON public.users ("帳號")';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = '財務' AND column_name = '專案ID'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_finance_project_id ON public."財務" ("專案ID")';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = '分潤表' AND column_name = '專案ID'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_payout_project_id ON public."分潤表" ("專案ID")';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = '大總表' AND column_name = '專案ID'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_master_project_id ON public."大總表" ("專案ID")';
  END IF;
END
$$;
