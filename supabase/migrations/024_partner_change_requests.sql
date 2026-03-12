-- 已上架 KOL 的修改不直接寫回 partners，改送審；核准後才更新主表
CREATE TABLE IF NOT EXISTS public.partner_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "PartnerID" text NOT NULL,
  "變更內容" jsonb NOT NULL DEFAULT '{}',
  "變更前快照" jsonb,
  "審核狀態" text NOT NULL DEFAULT '待審核',
  "建立者" text,
  "駁回理由" text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_partner_change_requests_partner
  ON public.partner_change_requests ("PartnerID");
CREATE INDEX IF NOT EXISTS idx_partner_change_requests_status
  ON public.partner_change_requests ("審核狀態");

COMMENT ON TABLE public.partner_change_requests IS '已核准 KOL 的變更申請；通過後合併回 partners';
COMMENT ON COLUMN public.partner_change_requests."變更內容" IS 'PATCH 欄位與新值';
COMMENT ON COLUMN public.partner_change_requests."變更前快照" IS '送審當下舊值，供審核頁 diff 標色';

-- 若 PATCH 仍 500：在 SQL Editor 確認 SELECT * FROM partner_change_requests 可執行；API 須設定 SUPABASE_SERVICE_ROLE_KEY
