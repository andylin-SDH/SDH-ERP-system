-- 發票清冊：新增收款對象，方便從 Google Sheet 匯入收款資料
ALTER TABLE public."發票"
  ADD COLUMN IF NOT EXISTS "收款對象" text;

COMMENT ON COLUMN public."發票"."收款對象" IS '收款對象／付款方／客戶名稱，供發票清冊與 Google Sheet 匯入使用';
