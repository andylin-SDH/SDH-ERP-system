-- 分潤表：欄位更名（與財務用語一致）
-- 大總表／財務：新增「廠商預計付款日」（與大總表專案編輯同步至財務）

-- 1) 大總表
ALTER TABLE public."大總表" ADD COLUMN IF NOT EXISTS "廠商預計付款日" text;

-- 2) 財務（依專案列，與大總表同步預計付款日）
ALTER TABLE public."財務" ADD COLUMN IF NOT EXISTS "廠商預計付款日" text;

-- 3) 分潤表：專案預計匯款日 → 廠商預計付款日
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = '分潤表' AND column_name = '專案預計匯款日'
  ) THEN
    ALTER TABLE public."分潤表" RENAME COLUMN "專案預計匯款日" TO "廠商預計付款日";
  END IF;
END $$;

-- 4) 分潤表：專案實際入帳日期 → 廠商付款日期（對應財務「廠商付款日期」）
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = '分潤表' AND column_name = '專案實際入帳日期'
  ) THEN
    ALTER TABLE public."分潤表" RENAME COLUMN "專案實際入帳日期" TO "廠商付款日期";
  END IF;
END $$;

COMMENT ON COLUMN public."大總表"."廠商預計付款日" IS '專案層預計；同步至財務與分潤表「廠商預計付款日」';
COMMENT ON COLUMN public."分潤表"."廠商預計付款日" IS '通常來自大總表；同步分潤時寫入';
COMMENT ON COLUMN public."分潤表"."廠商付款日期" IS '對應財務「廠商付款日期」';
