-- 勞務報酬收據欄位（對齊【SDH】勞務報酬收據.doc）
ALTER TABLE public."KOL發票"
  ADD COLUMN IF NOT EXISTS "領款方式" text,
  ADD COLUMN IF NOT EXISTS "聯絡電話" text,
  ADD COLUMN IF NOT EXISTS "戶籍地址" text,
  ADD COLUMN IF NOT EXISTS "扣繳稅額" text,
  ADD COLUMN IF NOT EXISTS "二代健保費" text,
  ADD COLUMN IF NOT EXISTS "實領金額" text;

COMMENT ON COLUMN public."KOL發票"."領款方式" IS '現金｜匯款';
COMMENT ON COLUMN public."KOL發票"."扣繳稅額" IS '各類所得 10%（單次達 2 萬）';
COMMENT ON COLUMN public."KOL發票"."二代健保費" IS '二代健保 1.91%（單次達 2 萬）';
COMMENT ON COLUMN public."KOL發票"."實領金額" IS '應領金額扣稅扣健保後實際匯款金額';
