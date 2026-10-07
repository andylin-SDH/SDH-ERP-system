-- 大總表：KOL 車馬費等額外成本。不回寫既有列；空值代表沒有這筆。
ALTER TABLE "大總表" ADD COLUMN IF NOT EXISTS "KOL應收額外成本" text;
