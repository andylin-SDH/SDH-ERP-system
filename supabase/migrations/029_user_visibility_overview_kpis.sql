-- 使用者可自訂總覽指標可見性（null = 依①角色預設）
ALTER TABLE "user_visibility" ADD COLUMN IF NOT EXISTS "overview_kpis" text[];

COMMENT ON COLUMN "user_visibility"."overview_kpis" IS '總覽 KPI key 列表；NULL 表示依 system_config overview_kpi_by_role 該角色預設';
