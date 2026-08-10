-- 額外獎金：同一專案可有多筆「分潤類型＝額外獎金」（不同領取人）
-- 實際索引名為 idx_分潤表_專案id_角色（id 小寫），對 (專案ID, 分潤類型) UNIQUE。

DROP INDEX IF EXISTS public."idx_分潤表_專案id_角色";
DROP INDEX IF EXISTS public."idx_分潤表_專案ID_角色";
DROP INDEX IF EXISTS public."idx_分潤表_專案ID_分潤類型";

COMMENT ON TABLE public."分潤表" IS '角色分潤（成數由大總表帶入）；分潤類型「額外獎金」為人工列，可多筆且重算時保留';