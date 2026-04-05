-- 財務表：語意由「狀態」改為「日期」（與發票表「廠商付款日期」區隔：不同資料表）
-- 若無「財務」表或欄位已更名，略過（可重複執行）

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = '財務'
      AND column_name = '廠商付款狀態'
  ) THEN
    ALTER TABLE public."財務" DROP CONSTRAINT IF EXISTS "財務_廠商付款狀態_fkey";
    ALTER TABLE public."財務" DROP CONSTRAINT IF EXISTS fk_財務_廠商付款狀態;
    ALTER TABLE public."財務" RENAME COLUMN "廠商付款狀態" TO "廠商付款日期";
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = '財務'
      AND column_name = '員工分潤狀態'
  ) THEN
    ALTER TABLE public."財務" RENAME COLUMN "員工分潤狀態" TO "員工分潤日期";
  END IF;
END $$;
