-- 大總表：母子專案關聯與合約連結
-- 母專案ID：指向另一筆大總表的「專案ID」，用來把子專案掛在母專案下（NULL 表示本身即為獨立/母專案）
-- 合約連結：合約雲端連結，全款以合約為準（母專案金額僅存當下應請款金額）

ALTER TABLE public."大總表"
ADD COLUMN IF NOT EXISTS "母專案ID" text;

ALTER TABLE public."大總表"
ADD COLUMN IF NOT EXISTS "合約連結" text;

-- 母專案ID 參照大總表(專案ID)；母專案被刪除時，子專案的母專案ID 自動設為 NULL（不連動刪除子專案）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = '大總表_母專案ID_fkey'
  ) THEN
    ALTER TABLE public."大總表"
    ADD CONSTRAINT "大總表_母專案ID_fkey"
    FOREIGN KEY ("母專案ID") REFERENCES public."大總表"("專案ID") ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "大總表_母專案ID_idx" ON public."大總表" ("母專案ID");

COMMENT ON COLUMN public."大總表"."母專案ID" IS '母專案的專案ID（子專案用；NULL 代表獨立或母專案）';
COMMENT ON COLUMN public."大總表"."合約連結" IS '合約雲端連結（全款以合約為準）';
