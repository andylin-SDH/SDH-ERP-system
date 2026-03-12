-- partners 表欄位為「經紀人」；000 migration 曾 INSERT match_fields 為「負責經紀人」且 ON CONFLICT DO NOTHING 導致舊庫一直錯
-- 改為空陣列 = 不篩選全顯；若要以經紀人篩選可改為 ARRAY['經紀人']
UPDATE visibility_rules
SET match_fields = '{}'::text[],
    updated_at = now()
WHERE table_key = 'partners'
  AND match_fields @> ARRAY['負責經紀人']::text[];
