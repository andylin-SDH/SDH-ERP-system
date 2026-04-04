-- 任務表：系統自動寫入之時間戳（不可由客戶端直接指定）
-- 開始時間：建立任務時寫入；完成時間：標記「任務完成」為 true 時寫入，取消完成時清空
ALTER TABLE public."任務" ADD COLUMN IF NOT EXISTS "開始時間" timestamptz;
ALTER TABLE public."任務" ADD COLUMN IF NOT EXISTS "完成時間" timestamptz;

-- 既有資料：開始時間以 created_at 回填（表無 created_at 時改以 now()）
DO $mig$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = '任務' AND column_name = 'created_at'
  ) THEN
    UPDATE public."任務" t
    SET "開始時間" = COALESCE(t."開始時間", t.created_at, now())
    WHERE t."開始時間" IS NULL;
  ELSE
    UPDATE public."任務" SET "開始時間" = COALESCE("開始時間", now()) WHERE "開始時間" IS NULL;
  END IF;
END $mig$;

COMMENT ON COLUMN public."任務"."開始時間" IS '任務建立當下由系統寫入';
COMMENT ON COLUMN public."任務"."完成時間" IS '任務標記完成當下由系統寫入；取消完成時清空';
