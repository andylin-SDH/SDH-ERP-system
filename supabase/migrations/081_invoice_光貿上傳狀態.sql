-- 光貿上傳狀態：開立後標「處理中」；僅手動刷新時才查光貿並更新。終態（完成／已作廢）不再打 API。
ALTER TABLE public."發票" ADD COLUMN IF NOT EXISTS "光貿上傳狀態" text;
ALTER TABLE public."發票" ADD COLUMN IF NOT EXISTS "光貿狀態更新時間" text;

COMMENT ON COLUMN public."發票"."光貿上傳狀態" IS '光貿上傳狀態顯示（處理中／待處理／完成／錯誤／已作廢等）。空＝非光貿開立或尚未追蹤。';
COMMENT ON COLUMN public."發票"."光貿狀態更新時間" IS '最近一次向光貿查詢或寫入狀態的時間（ISO）。';
