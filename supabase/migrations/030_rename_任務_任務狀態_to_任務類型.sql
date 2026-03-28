-- 任務表：「任務狀態」更名為「任務類型」（語意與 UI 一致）
-- 若欄位已為「任務類型」則跳過（可重複執行）
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = '任務' AND column_name = '任務狀態'
  ) THEN
    ALTER TABLE public."任務" RENAME COLUMN "任務狀態" TO "任務類型";
  END IF;
END $$;

COMMENT ON COLUMN public."任務"."任務類型" IS '任務類型（下拉選項由 system_config.task_type_options 維護）';

-- 系統設定：下拉選項 key 自 task_status_options 遷移至 task_type_options
UPDATE public.system_config
SET key = 'task_type_options', updated_at = now()
WHERE key = 'task_status_options';
