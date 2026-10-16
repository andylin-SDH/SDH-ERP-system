-- 新專案標記「只留專案PM、主管」。只新增欄位，不回填舊專案。
ALTER TABLE public."大總表"
  ADD COLUMN IF NOT EXISTS "分潤制度" text;

COMMENT ON COLUMN public."大總表"."分潤制度" IS '兩角色＝新專案只產生專案PM 7.5% 與主管 2.5%。空白＝舊專案，沿用原有分潤角色。';
