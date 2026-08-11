-- KOL 批次請款：同一發票套多案；勞報合計拆成每張 < 2 萬的單據

ALTER TABLE public."KOL發票"
  ADD COLUMN IF NOT EXISTS "請款批次ID" uuid;

COMMENT ON COLUMN public."KOL發票"."請款批次ID" IS '若由此批次請款產生，對應 KOL請款批次.id';

CREATE TABLE IF NOT EXISTS public."KOL請款批次" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "PartnerID" text NOT NULL,
  "請款方式" text NOT NULL CHECK ("請款方式" IN ('發票', '勞務報酬')),
  "KOL發票號碼" text,
  "KOL發票日期" date,
  "KOL發票備註" text,
  "勞務期間起" date,
  "勞務期間迄" date,
  "勞務內容" text,
  "身分證字號" text,
  "領款方式" text,
  "聯絡電話" text,
  "戶籍地址" text,
  "勞報簽名" text,
  "勞報簽署時間" timestamptz,
  "合計金額" integer NOT NULL DEFAULT 0,
  "單據張數" integer NOT NULL DEFAULT 0,
  "填寫人" text,
  "填寫來源" text NOT NULL DEFAULT 'KOL',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kol_claim_batch_partner
  ON public."KOL請款批次" ("PartnerID");

COMMENT ON TABLE public."KOL請款批次" IS 'KOL 勾選多專案一次提領產生的請款批次';

CREATE TABLE IF NOT EXISTS public."KOL請款批次項目" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "批次ID" uuid NOT NULL REFERENCES public."KOL請款批次"(id) ON DELETE CASCADE,
  "專案ID" text NOT NULL,
  "金額快照" integer NOT NULL DEFAULT 0,
  "專案名稱" text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("批次ID", "專案ID")
);

CREATE INDEX IF NOT EXISTS idx_kol_claim_batch_item_project
  ON public."KOL請款批次項目" ("專案ID");

COMMENT ON TABLE public."KOL請款批次項目" IS '批次內勾選的專案與當下 KOL費用未稅快照';

CREATE TABLE IF NOT EXISTS public."KOL勞報單據" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "批次ID" uuid NOT NULL REFERENCES public."KOL請款批次"(id) ON DELETE CASCADE,
  "序號" integer NOT NULL,
  "給付總額" integer NOT NULL CHECK ("給付總額" > 0 AND "給付總額" < 20000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("批次ID", "序號")
);

CREATE INDEX IF NOT EXISTS idx_kol_labor_slip_batch
  ON public."KOL勞報單據" ("批次ID");

COMMENT ON TABLE public."KOL勞報單據" IS '勞報批次拆單後的單據（每張給付總額必須 < 20000）';

CREATE TABLE IF NOT EXISTS public."KOL勞報單據分配" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "單據ID" uuid NOT NULL REFERENCES public."KOL勞報單據"(id) ON DELETE CASCADE,
  "批次ID" uuid NOT NULL REFERENCES public."KOL請款批次"(id) ON DELETE CASCADE,
  "專案ID" text NOT NULL,
  "分配金額" integer NOT NULL CHECK ("分配金額" > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kol_labor_alloc_slip
  ON public."KOL勞報單據分配" ("單據ID");
CREATE INDEX IF NOT EXISTS idx_kol_labor_alloc_project
  ON public."KOL勞報單據分配" ("專案ID");

COMMENT ON TABLE public."KOL勞報單據分配" IS '單據金額如何由各專案分攤（一專案可跨多張單據）';

CREATE INDEX IF NOT EXISTS idx_kol_invoice_claim_batch
  ON public."KOL發票" ("請款批次ID")
  WHERE "請款批次ID" IS NOT NULL;
