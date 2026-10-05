-- 五吉郎跟錄名單。只新增表，並在還沒有這筆節目時補上預設。已有的列不改。
CREATE TABLE IF NOT EXISTS public."跟錄名單" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "節目" text NOT NULL,
  "關鍵字" text NOT NULL DEFAULT '',
  "同行" text NOT NULL DEFAULT '',
  "折扣碼" text NOT NULL DEFAULT '',
  "更新時間" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "跟錄名單_節目" UNIQUE ("節目")
);

INSERT INTO public."跟錄名單" ("節目", "關鍵字", "同行", "折扣碼")
VALUES
  ('灃食 食光餐桌', '灃食、食光餐桌', '維尼', ''),
  ('能量黑客', '能量黑客、林揚程', '', 'hank4'),
  ('蘇心時光', '蘇心時光', '', 'Gracesu4'),
  ('愛莉說好室', '愛莉說好室、愛莉', '', ''),
  ('一不小心變漂亮', '一不小心變漂亮、崔咪', '', ''),
  ('慢慢長出來', '慢慢長出來、Z研', '', ''),
  ('艾瑪的空中排練場', '艾瑪的空中排練場、蕭艾瑪、艾瑪', '', ''),
  ('JO伙闖天下', 'JO伙闖天下、JO伙、Jonas', '', ''),
  ('Hugo陪你聊', 'Hugo陪你聊、Hugo、維思', '', '')
ON CONFLICT ("節目") DO NOTHING;

COMMENT ON TABLE public."跟錄名單" IS '需要五吉郎跟錄的節目。折扣碼只給伺服器比對，不回傳給網頁。';
