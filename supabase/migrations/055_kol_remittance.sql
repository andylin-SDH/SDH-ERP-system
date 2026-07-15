-- KOL 匯款：KOL發票加匯款摘要；付款記錄加匯款類型
ALTER TABLE public."KOL發票"
  ADD COLUMN IF NOT EXISTS "KOL匯款日期" date,
  ADD COLUMN IF NOT EXISTS "KOL匯款金額" text;

COMMENT ON COLUMN public."KOL發票"."KOL匯款日期" IS 'SDH 匯款給 KOL 的日期；有值時 KOL 入口顯示已匯款';
COMMENT ON COLUMN public."KOL發票"."KOL匯款金額" IS 'SDH 匯給 KOL 的金額（文字，沿用財務欄位模式）';

ALTER TABLE public."付款記錄"
  ADD COLUMN IF NOT EXISTS "匯款類型" text;

COMMENT ON COLUMN public."付款記錄"."匯款類型" IS 'KOL｜廠商｜其他；KOL 匯款登記時為 KOL';

CREATE INDEX IF NOT EXISTS idx_kol_invoices_匯款日期
  ON public."KOL發票" ("KOL匯款日期")
  WHERE "KOL匯款日期" IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_付款記錄_匯款類型
  ON public."付款記錄" ("匯款類型")
  WHERE "匯款類型" IS NOT NULL;
