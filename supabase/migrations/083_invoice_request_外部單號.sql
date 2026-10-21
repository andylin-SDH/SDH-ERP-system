-- 錄音室預約等外部來源的訂單編號。只加欄、不改既有申請。
ALTER TABLE public."發票開立申請"
  ADD COLUMN IF NOT EXISTS "外部單號" text;

COMMENT ON COLUMN public."發票開立申請"."外部單號" IS '外部來源訂單編號（例如錄音室預約）。同一單號只建立一筆開立申請，不覆寫既有列。';

CREATE UNIQUE INDEX IF NOT EXISTS idx_發票開立申請_外部單號
  ON public."發票開立申請" ("外部單號")
  WHERE "外部單號" IS NOT NULL AND "外部單號" <> '';
