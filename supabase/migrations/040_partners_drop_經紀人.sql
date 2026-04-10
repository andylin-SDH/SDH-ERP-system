-- partners 的「經紀人」已改由大總表專案手填，不再存於合作夥伴主檔
ALTER TABLE IF EXISTS "partners"
DROP COLUMN IF EXISTS "經紀人";

-- 兼容舊資料：若 visibility_rules 仍誤存 partners.經紀人，清掉避免空欄篩選
UPDATE "visibility_rules"
SET "match_fields" = array_remove("match_fields", '經紀人'),
    "updated_at" = now()
WHERE "table_key" = 'partners'
  AND ("match_fields" @> ARRAY['經紀人']::text[] OR "match_fields" @> ARRAY['負責經紀人']::text[]);

UPDATE "visibility_rules"
SET "match_fields" = array_remove("match_fields", '負責經紀人'),
    "updated_at" = now()
WHERE "table_key" = 'partners'
  AND "match_fields" @> ARRAY['負責經紀人']::text[];
