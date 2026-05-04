-- KOL／合作夥伴：補齊兩個分潤%數欄位（若舊環境尚未執行 035，可直接執行此 migration）
ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS "自來件分潤" text,
  ADD COLUMN IF NOT EXISTS "SDH開發分件分潤" text;

COMMENT ON COLUMN public.partners."自來件分潤" IS '自來件分潤%數（顯示於 KOL 與業配專案參考）';
COMMENT ON COLUMN public.partners."SDH開發分件分潤" IS 'SDH 開發件分潤%數（顯示於 KOL 與業配專案參考）';

-- 財務：付款記錄（支出／對外付款）
CREATE TABLE IF NOT EXISTS public."付款記錄" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "發票號碼" text,
  "付款日期" text,
  "付款專案" text,
  "付款對象" text,
  "付款金額" text,
  "備註" text,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);

COMMENT ON TABLE public."付款記錄" IS '財務付款記錄：記錄對外付款、支出與付款對象';
COMMENT ON COLUMN public."付款記錄"."發票號碼" IS '付款對應發票或憑證號碼，可空白';
COMMENT ON COLUMN public."付款記錄"."付款日期" IS '付款日期（yyyy-MM-dd 或自由文字）';
COMMENT ON COLUMN public."付款記錄"."付款專案" IS '付款專案或支出事項';
COMMENT ON COLUMN public."付款記錄"."付款對象" IS '付款對象／廠商／個人';
COMMENT ON COLUMN public."付款記錄"."付款金額" IS '付款金額，文字儲存以沿用現有財務欄位模式';

CREATE INDEX IF NOT EXISTS idx_付款記錄_付款日期 ON public."付款記錄"("付款日期");
CREATE INDEX IF NOT EXISTS idx_付款記錄_付款對象 ON public."付款記錄"("付款對象");
CREATE INDEX IF NOT EXISTS idx_付款記錄_發票號碼 ON public."付款記錄"("發票號碼");
