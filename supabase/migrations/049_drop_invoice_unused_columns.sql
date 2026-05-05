-- 發票清冊：移除不再使用的金額與狀態欄位
ALTER TABLE public."發票"
  DROP COLUMN IF EXISTS "發票金額未稅",
  DROP COLUMN IF EXISTS "發票稅金",
  DROP COLUMN IF EXISTS "廠商實付金額",
  DROP COLUMN IF EXISTS "廠商付款狀態";
