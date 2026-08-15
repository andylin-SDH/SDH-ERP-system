-- 資料保護：KOL／大總表改軟刪；稽核紀錄永不隨主檔清除
-- 封存滿 ARCHIVE_RETENTION_DAYS（預設 30）天後由 /api/cron/purge-archived 永久清除主檔
-- 請於 Supabase SQL Editor 執行本檔後，軟刪／還原才會生效

ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by text,
  ADD COLUMN IF NOT EXISTS delete_reason text;

COMMENT ON COLUMN public.partners.deleted_at IS '軟刪時間；NULL=有效';
COMMENT ON COLUMN public.partners.deleted_by IS '執行軟刪者（姓名或 email）';
COMMENT ON COLUMN public.partners.delete_reason IS '軟刪原因（選填）';

CREATE INDEX IF NOT EXISTS idx_partners_deleted_at
  ON public.partners (deleted_at)
  WHERE deleted_at IS NULL;

ALTER TABLE public."大總表"
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by text,
  ADD COLUMN IF NOT EXISTS delete_reason text;

COMMENT ON COLUMN public."大總表".deleted_at IS '軟刪時間；NULL=有效';
COMMENT ON COLUMN public."大總表".deleted_by IS '執行軟刪者（姓名或 email）';
COMMENT ON COLUMN public."大總表".delete_reason IS '軟刪原因（選填）';

CREATE INDEX IF NOT EXISTS idx_master_deleted_at
  ON public."大總表" (deleted_at)
  WHERE deleted_at IS NULL;
