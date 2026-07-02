-- 專案收款連結（一專案一連結）與匯款方填寫之收款申報（供日後自動對帳）

CREATE TABLE IF NOT EXISTS public."專案收款連結" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "專案ID" text NOT NULL UNIQUE REFERENCES public."大總表"("專案ID") ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  "建立人" text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_專案收款連結_token ON public."專案收款連結" (token);

CREATE TABLE IF NOT EXISTS public."收款申報" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "專案ID" text NOT NULL REFERENCES public."大總表"("專案ID") ON DELETE CASCADE,
  "連結ID" uuid REFERENCES public."專案收款連結"(id) ON DELETE SET NULL,
  "匯款單位" text NOT NULL,
  "匯款日期" date NOT NULL,
  "匯款金額" numeric,
  "匯款末五碼" text NOT NULL,
  "匯款帳號" text,
  "聯絡人" text,
  "聯絡Email" text,
  "聯絡電話" text,
  "備註" text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_收款申報_專案ID ON public."收款申報" ("專案ID");
CREATE INDEX IF NOT EXISTS idx_收款申報_末五碼 ON public."收款申報" ("匯款末五碼");

COMMENT ON TABLE public."專案收款連結" IS '一專案一收款表單連結 token，供匯款方填寫匯款資訊';
COMMENT ON TABLE public."收款申報" IS '匯款方透過收款表單提交之匯款資訊，供日後自動對帳';
