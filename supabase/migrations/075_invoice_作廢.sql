-- 發票清冊：光貿作廢後只標記，不刪列、不改金額與付款日。
ALTER TABLE public."發票" ADD COLUMN IF NOT EXISTS "作廢時間" text;
ALTER TABLE public."發票" ADD COLUMN IF NOT EXISTS "作廢原因" text;

COMMENT ON COLUMN public."發票"."作廢時間" IS '光貿作廢成功的時間（ISO）。空值表示未作廢。';
COMMENT ON COLUMN public."發票"."作廢原因" IS '作廢原因，最多 20 字，對應光貿 CancelReason。';
