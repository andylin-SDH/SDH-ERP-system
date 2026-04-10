-- 分潤模式 B（廣告業配）：與模式 A 分離「專案引薦人」欄位，改為「專案開發人」
ALTER TABLE IF EXISTS "大總表"
ADD COLUMN IF NOT EXISTS "專案開發人" text,
ADD COLUMN IF NOT EXISTS "專案開發人分潤成數" text;

-- 既有廣告業配專案：由舊欄位帶入
UPDATE "大總表"
SET
  "專案開發人" = COALESCE(NULLIF(TRIM("專案開發人"), ''), NULLIF(TRIM("專案引薦人"), '')),
  "專案開發人分潤成數" = COALESCE(NULLIF(TRIM("專案開發人分潤成數"), ''), NULLIF(TRIM("專案引薦人分潤成數"), ''))
WHERE TRIM(COALESCE("專案類型", '')) = '廣告業配';

-- 模式 B 不再使用「專案引薦人」兩欄（避免與製作/活動案混淆）
UPDATE "大總表"
SET
  "專案引薦人" = NULL,
  "專案引薦人分潤成數" = NULL
WHERE TRIM(COALESCE("專案類型", '')) = '廣告業配';
