-- =============================================================================
-- 財務／發票模組調整（與應用程式「發票併入財務分頁」一致）
-- 1) 發票可不綁專案（雜項／彙開等），專案刪除時發票列保留並清空專案ID
-- 2) 建議：舊 user_visibility.tables 若含 'invoices'，可改為只保留 'finance'（下段選用）
-- =============================================================================

-- 發票：專案ID 改為可 NULL，並重建 FK 為 ON DELETE SET NULL
ALTER TABLE public."發票" DROP CONSTRAINT IF EXISTS fk_發票_專案ID;

ALTER TABLE public."發票" ALTER COLUMN "專案ID" DROP NOT NULL;

ALTER TABLE public."發票"
  ADD CONSTRAINT fk_發票_專案ID
  FOREIGN KEY ("專案ID") REFERENCES public."大總表"("專案ID") ON DELETE SET NULL;

COMMENT ON COLUMN public."發票"."專案ID" IS '可為空：無專案之發票：有專案時連動大總表';

-- 將 user_visibility.tables 中的 invoices 整併為 finance（去重、排序）
UPDATE public."user_visibility" u
SET tables = (
  SELECT COALESCE(array_agg(sub.mapped ORDER BY sub.mapped), '{}'::text[])
  FROM (
    SELECT DISTINCT (CASE WHEN t = 'invoices' THEN 'finance' ELSE t END) AS mapped
    FROM unnest(u.tables) AS t
  ) AS sub
)
WHERE 'invoices' = ANY(u.tables);
