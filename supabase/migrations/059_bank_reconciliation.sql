-- 銀行收款自動對帳（第一版：CSV 匯入、規則候選、人工確認後寫回發票）

CREATE TABLE IF NOT EXISTS public."對帳執行紀錄" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "來源" text NOT NULL DEFAULT 'cathay_csv',
  "檔名" text,
  "原始筆數" integer NOT NULL DEFAULT 0,
  "匯入筆數" integer NOT NULL DEFAULT 0,
  "重複筆數" integer NOT NULL DEFAULT 0,
  "錯誤筆數" integer NOT NULL DEFAULT 0,
  "錯誤明細" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "執行人" text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."銀行交易" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "來源" text NOT NULL DEFAULT 'cathay_csv',
  "來源帳戶" text,
  "銀行交易序號" text,
  "交易日期" date NOT NULL,
  "入帳日期" date,
  "金額" numeric(16, 2) NOT NULL CHECK ("金額" > 0),
  "幣別" text NOT NULL DEFAULT 'TWD',
  "方向" text NOT NULL DEFAULT 'credit' CHECK ("方向" IN ('credit', 'debit')),
  "匯款人" text,
  "匯款帳號" text,
  "匯款末五碼" text,
  "交易摘要" text,
  "原始資料" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "指紋" text NOT NULL UNIQUE,
  "狀態" text NOT NULL DEFAULT 'unmatched'
    CHECK ("狀態" IN ('unmatched', 'suggested', 'matched', 'ignored')),
  "匯入批次ID" uuid REFERENCES public."對帳執行紀錄"(id) ON DELETE SET NULL,
  "匯入人" text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."對帳結果" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "銀行交易ID" uuid NOT NULL REFERENCES public."銀行交易"(id) ON DELETE CASCADE,
  "收款申報ID" uuid REFERENCES public."收款申報"(id) ON DELETE SET NULL,
  "專案ID" text NOT NULL REFERENCES public."大總表"("專案ID") ON DELETE CASCADE,
  "發票IDs" uuid[] NOT NULL,
  "候選識別碼" text NOT NULL,
  "候選金額" numeric(16, 2) NOT NULL,
  "分數" integer NOT NULL CHECK ("分數" BETWEEN 0 AND 100),
  "匹配原因" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "狀態" text NOT NULL DEFAULT 'suggested'
    CHECK ("狀態" IN ('suggested', 'confirmed', 'rejected')),
  "確認人" text,
  "確認時間" timestamptz,
  "寫回日期" date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("銀行交易ID", "候選識別碼")
);

CREATE INDEX IF NOT EXISTS idx_銀行交易_交易日期 ON public."銀行交易"("交易日期" DESC);
CREATE INDEX IF NOT EXISTS idx_銀行交易_狀態 ON public."銀行交易"("狀態");
CREATE INDEX IF NOT EXISTS idx_銀行交易_匯款末五碼 ON public."銀行交易"("匯款末五碼");
CREATE INDEX IF NOT EXISTS idx_對帳結果_銀行交易ID ON public."對帳結果"("銀行交易ID");
CREATE INDEX IF NOT EXISTS idx_對帳結果_狀態 ON public."對帳結果"("狀態");
CREATE INDEX IF NOT EXISTS idx_對帳結果_專案ID ON public."對帳結果"("專案ID");

COMMENT ON TABLE public."銀行交易" IS '從銀行匯入的入帳交易；指紋用於避免重複匯入';
COMMENT ON TABLE public."對帳結果" IS '銀行交易與 ERP 專案／發票的匹配候選及人工確認結果';
COMMENT ON TABLE public."對帳執行紀錄" IS '每次銀行檔案匯入的稽核紀錄';

-- 銀行資料含敏感交易資訊，只允許後端 service role 經過 ERP 權限檢查後存取。
ALTER TABLE public."銀行交易" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."對帳結果" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."對帳執行紀錄" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."銀行交易", public."對帳結果", public."對帳執行紀錄" FROM anon, authenticated;

-- 確認對帳時，於同一個 DB transaction 鎖定銀行交易並寫回所有候選發票。
CREATE OR REPLACE FUNCTION public.confirm_reconciliation_match(
  p_match_id uuid,
  p_confirmed_by text
)
RETURNS TABLE("專案ID" text, "寫回日期" date)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m record;
  conflicting_count integer;
  invoice_count integer;
BEGIN
  SELECT
    r.id,
    r."銀行交易ID",
    r."專案ID",
    r."發票IDs",
    r."狀態" AS match_status,
    t."交易日期",
    t."狀態" AS transaction_status
  INTO m
  FROM public."對帳結果" r
  JOIN public."銀行交易" t ON t.id = r."銀行交易ID"
  WHERE r.id = p_match_id
  FOR UPDATE OF r, t;

  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到對帳候選';
  END IF;

  IF m.match_status = 'confirmed' THEN
    RETURN QUERY SELECT m."專案ID"::text, m."交易日期"::date;
    RETURN;
  END IF;

  IF m.match_status <> 'suggested' THEN
    RAISE EXCEPTION '此候選已被排除，請重新執行匹配';
  END IF;

  IF m.transaction_status = 'matched' THEN
    RAISE EXCEPTION '此銀行交易已由其他候選完成對帳';
  END IF;

  IF m."發票IDs" IS NULL OR cardinality(m."發票IDs") = 0 THEN
    RAISE EXCEPTION '候選沒有可寫回的發票';
  END IF;

  SELECT count(*)
  INTO invoice_count
  FROM public."發票" i
  WHERE i.id = ANY(m."發票IDs")
    AND i."專案ID" = m."專案ID";

  IF invoice_count <> cardinality(m."發票IDs") THEN
    RAISE EXCEPTION '候選發票不存在或不屬於指定專案';
  END IF;

  SELECT count(*)
  INTO conflicting_count
  FROM public."發票" i
  WHERE i.id = ANY(m."發票IDs")
    AND NULLIF(trim(COALESCE(i."廠商付款日期", '')), '') IS NOT NULL
    AND trim(i."廠商付款日期") <> m."交易日期"::text;

  IF conflicting_count > 0 THEN
    RAISE EXCEPTION '候選發票已有不同的入帳日期，請先人工檢查';
  END IF;

  UPDATE public."發票"
  SET "廠商付款日期" = m."交易日期"::text
  WHERE id = ANY(m."發票IDs")
    AND NULLIF(trim(COALESCE("廠商付款日期", '')), '') IS NULL;

  IF NOT FOUND THEN
    -- 允許相同日期的重試，但至少要確認發票仍存在。
    IF NOT EXISTS (SELECT 1 FROM public."發票" WHERE id = ANY(m."發票IDs")) THEN
      RAISE EXCEPTION '候選發票已不存在';
    END IF;
  END IF;

  UPDATE public."對帳結果"
  SET
    "狀態" = CASE WHEN id = p_match_id THEN 'confirmed' ELSE 'rejected' END,
    "確認人" = CASE WHEN id = p_match_id THEN p_confirmed_by ELSE "確認人" END,
    "確認時間" = CASE WHEN id = p_match_id THEN now() ELSE "確認時間" END,
    "寫回日期" = CASE WHEN id = p_match_id THEN m."交易日期" ELSE "寫回日期" END,
    updated_at = now()
  WHERE "銀行交易ID" = m."銀行交易ID"
    AND "狀態" = 'suggested';

  UPDATE public."銀行交易"
  SET "狀態" = 'matched', updated_at = now()
  WHERE id = m."銀行交易ID";

  RETURN QUERY SELECT m."專案ID"::text, m."交易日期"::date;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_reconciliation_match(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_reconciliation_match(uuid, text) TO service_role;
