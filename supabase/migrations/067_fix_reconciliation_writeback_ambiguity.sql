-- 修正 confirm_reconciliation_match 的回傳欄位「寫回日期」與資料表欄位同名時產生歧義。
-- 066 已執行過或舊版 059 已建立函式時，可單獨安全執行本檔。

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

  UPDATE public."發票" AS invoice
  SET "廠商付款日期" = m."交易日期"::text
  WHERE invoice.id = ANY(m."發票IDs")
    AND NULLIF(trim(COALESCE(invoice."廠商付款日期", '')), '') IS NULL;

  IF NOT FOUND THEN
    IF NOT EXISTS (SELECT 1 FROM public."發票" i WHERE i.id = ANY(m."發票IDs")) THEN
      RAISE EXCEPTION '候選發票已不存在';
    END IF;
  END IF;

  UPDATE public."對帳結果" AS result
  SET
    "狀態" = CASE WHEN result.id = p_match_id THEN 'confirmed' ELSE 'rejected' END,
    "確認人" = CASE WHEN result.id = p_match_id THEN p_confirmed_by ELSE result."確認人" END,
    "確認時間" = CASE WHEN result.id = p_match_id THEN now() ELSE result."確認時間" END,
    "寫回日期" = CASE WHEN result.id = p_match_id THEN m."交易日期" ELSE result."寫回日期" END,
    updated_at = now()
  WHERE result."銀行交易ID" = m."銀行交易ID"
    AND result."狀態" = 'suggested';

  UPDATE public."銀行交易" AS transaction
  SET "狀態" = 'matched', updated_at = now()
  WHERE transaction.id = m."銀行交易ID";

  RETURN QUERY SELECT m."專案ID"::text, m."交易日期"::date;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_reconciliation_match(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_reconciliation_match(uuid, text) TO service_role;
