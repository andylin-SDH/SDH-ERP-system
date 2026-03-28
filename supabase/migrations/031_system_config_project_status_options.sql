-- 大總表「專案狀態」下拉選項（與前端 system_config.project_status_options 一致）
-- 若尚未設定過則寫入預設三項；已存在則不覆寫（保留管理者自訂）
INSERT INTO public.system_config (key, value, updated_at)
VALUES (
  'project_status_options',
  '["進行中", "暫緩", "結案"]'::jsonb,
  now()
)
ON CONFLICT (key) DO NOTHING;
