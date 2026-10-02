-- 員工分潤提領：廠商已付款、尚未匯出時，由領取人提出申請。只新增欄位。
ALTER TABLE public."分潤表"
  ADD COLUMN IF NOT EXISTS "提領申請日" text;

COMMENT ON COLUMN public."分潤表"."提領申請日" IS '領取人提出提領的日期；空白表示尚未申請。已有分潤匯款日期者不再改此欄。';
