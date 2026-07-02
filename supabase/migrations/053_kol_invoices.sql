-- KOL 向 SDH 請款發票（一專案一列；同一發票號碼可對應多個專案）
CREATE TABLE IF NOT EXISTS public."KOL發票" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "專案ID" text NOT NULL UNIQUE REFERENCES public."大總表"("專案ID") ON DELETE CASCADE,
  "KOL發票號碼" text,
  "KOL發票日期" date,
  "KOL發票備註" text,
  "填寫來源" text,
  "填寫人" text,
  "填寫時間" timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kol_invoices_發票號碼
  ON public."KOL發票" ("KOL發票號碼")
  WHERE "KOL發票號碼" IS NOT NULL AND btrim("KOL發票號碼") <> '';

COMMENT ON TABLE public."KOL發票" IS 'KOL 向 SDH 請款時開立之發票；一專案一列，發票號碼可重複（多專案併開一張）';
COMMENT ON COLUMN public."KOL發票"."填寫來源" IS 'KOL 或 內部';
