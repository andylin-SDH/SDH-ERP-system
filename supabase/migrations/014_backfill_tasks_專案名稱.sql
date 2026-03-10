-- 將既有任務的 專案名稱 從 大總表 補齊
UPDATE "任務" t
SET "專案名稱" = m."專案名稱"
FROM "大總表" m
WHERE t."專案ID" = m."專案ID"
  AND (t."專案名稱" IS NULL OR t."專案名稱" = '');
