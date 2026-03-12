-- 已核准 KOL 被非管理者修改後改回待審核時，記錄是誰送出的，待審核列表才能篩給該人看
ALTER TABLE public.partners ADD COLUMN IF NOT EXISTS "待審核送出者" text;

COMMENT ON COLUMN public.partners."待審核送出者" IS '已上架後再編輯並送審者的 email；與建立者並列供待審核列表篩選';
