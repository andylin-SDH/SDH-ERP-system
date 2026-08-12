-- 大總表編輯歷史：開放金額修改後可稽核誰改了什麼
CREATE TABLE IF NOT EXISTS public.master_edit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "專案ID" text NOT NULL,
  "操作" text NOT NULL DEFAULT '編輯',
  "更新者" text NOT NULL,
  "變更內容" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "變更前快照" jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_master_edit_log_project
  ON public.master_edit_log ("專案ID");
CREATE INDEX IF NOT EXISTS idx_master_edit_log_created
  ON public.master_edit_log (created_at DESC);

COMMENT ON TABLE public.master_edit_log IS '大總表新增／編輯歷史；含變更欄位與變更前快照（金額異動必留痕）';
COMMENT ON COLUMN public.master_edit_log."操作" IS '新增 | 編輯 | 刪除';
COMMENT ON COLUMN public.master_edit_log."更新者" IS '儲存當下使用者（姓名或 email）';
