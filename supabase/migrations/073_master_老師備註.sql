-- 大總表：給老師看的備註。不回寫既有列；空值代表沒有這段話。
-- 原「備註」仍只供內部，不會出現在老師後台。
ALTER TABLE "大總表" ADD COLUMN IF NOT EXISTS "老師備註" text;

COMMENT ON COLUMN "大總表"."老師備註" IS '給老師看的備註，顯示於 KOL 後台。內部備註欄不對老師公開。';
