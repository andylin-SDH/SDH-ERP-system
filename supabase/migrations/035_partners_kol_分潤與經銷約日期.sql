-- KOL／合作夥伴：自來件與 SDH 開發分潤、經銷約起訖（text，與其他日期／成數欄位一致）
ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS "自來件分潤" text,
  ADD COLUMN IF NOT EXISTS "SDH開發分件分潤" text,
  ADD COLUMN IF NOT EXISTS "經銷約開始日" text,
  ADD COLUMN IF NOT EXISTS "經銷約結束日" text;

COMMENT ON COLUMN public.partners."自來件分潤" IS '自來件分潤（成數或文字，依業務約定）';
COMMENT ON COLUMN public.partners."SDH開發分件分潤" IS 'SDH 開發分件分潤（成數或文字）';
COMMENT ON COLUMN public.partners."經銷約開始日" IS '經銷約開始日（可 yyyy-MM-dd 或自由文字）';
COMMENT ON COLUMN public.partners."經銷約結束日" IS '經銷約結束日（可 yyyy-MM-dd 或自由文字）';
