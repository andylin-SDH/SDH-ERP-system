-- ② 資料可見規則：大總表已區分「專案引薦人（製作／活動）」與「專案開發人（廣告業配）」
-- 若舊設定僅勾選 專案引薦人，一併加入 專案開發人，避免廣告業配列無法依姓名／Email 顯示
UPDATE "visibility_rules"
SET
  "match_fields" = "match_fields" || ARRAY['專案開發人']::text[],
  "updated_at" = now()
WHERE "table_key" = 'master'
  AND '專案引薦人' = ANY ("match_fields")
  AND NOT ('專案開發人' = ANY ("match_fields"));
