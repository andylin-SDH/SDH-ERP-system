-- KOL 勞報：員工後台下載 PDF 注記（最後下載時間）
ALTER TABLE public."KOL發票"
  ADD COLUMN IF NOT EXISTS "勞報下載時間" timestamptz;

COMMENT ON COLUMN public."KOL發票"."勞報下載時間" IS '員工後台最後下載勞報 PDF 的時間；用於匯款列表已下載注記';
