-- 移除 KOL 審核流程：刪除待審核／已駁回列、清空變更申請，改以 edit log 追蹤編輯歷史

DELETE FROM public.partner_change_requests;

DELETE FROM public.partners
WHERE trim(coalesce("審核狀態", '')) IN ('待審核', '已駁回');

ALTER TABLE public.partners ADD COLUMN IF NOT EXISTS "最後更新者" text;
ALTER TABLE public.partners ADD COLUMN IF NOT EXISTS "最後更新時間" timestamptz;

COMMENT ON COLUMN public.partners."最後更新者" IS '最近一次儲存此 KOL 的使用者（姓名或 email）';
COMMENT ON COLUMN public.partners."最後更新時間" IS '最近一次儲存時間';

CREATE TABLE IF NOT EXISTS public.partner_edit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "PartnerID" text NOT NULL,
  "操作" text NOT NULL DEFAULT '編輯',
  "更新者" text NOT NULL,
  "變更內容" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "變更前快照" jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_partner_edit_log_partner
  ON public.partner_edit_log ("PartnerID");
CREATE INDEX IF NOT EXISTS idx_partner_edit_log_created
  ON public.partner_edit_log (created_at DESC);

COMMENT ON TABLE public.partner_edit_log IS 'KOL 新增／編輯完整歷史；含變更欄位與變更前快照';
COMMENT ON COLUMN public.partner_edit_log."操作" IS '新增 | 編輯 | 刪除';
COMMENT ON COLUMN public.partner_edit_log."更新者" IS '儲存當下使用者（姓名或 email）';
