-- 發票開立申請：送審用。放行成功後才寫入「發票」。不回溯、不覆蓋清冊。
CREATE TABLE IF NOT EXISTS public."發票開立申請" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "狀態" text NOT NULL DEFAULT '待審核',
  "專案ID" text,
  "買受人統編" text,
  "買受人名稱" text,
  "買受人Email" text,
  "買受人地址" text,
  "發票備註" text,
  "課稅別" text,
  "單價模式" text,
  "通關方式" integer,
  "零稅率原因" integer,
  "明細" jsonb,
  "銷售額" text,
  "稅額" text,
  "發票總金額" text,
  "申請人Email" text,
  "申請人" text,
  "申請時間" timestamptz NOT NULL DEFAULT now(),
  "審核人" text,
  "審核時間" timestamptz,
  "退回原因" text,
  "訂單編號" text,
  "發票號碼" text,
  "發票日期" text,
  "隨機碼" text,
  "開立錯誤" text
);

COMMENT ON TABLE public."發票開立申請" IS '開立發票送審。狀態：待審核、已放行、已退回。已放行才代表光貿已開立。';
COMMENT ON COLUMN public."發票開立申請"."狀態" IS '待審核、已放行、已退回';

ALTER TABLE public."發票開立申請" ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_發票開立申請_狀態 ON public."發票開立申請" ("狀態");
CREATE INDEX IF NOT EXISTS idx_發票開立申請_專案 ON public."發票開立申請" ("專案ID");
