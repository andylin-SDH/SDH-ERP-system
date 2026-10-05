-- 班表：一列是某人在某一天某個整點排在某地點。只新增表，不改既有業務資料。
CREATE TABLE IF NOT EXISTS public."班表" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "日期" text NOT NULL,
  "整點" text NOT NULL,
  "地點" text NOT NULL,
  "人員" text NOT NULL,
  "更新時間" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "班表_人日時地" UNIQUE ("日期", "整點", "地點", "人員")
);

COMMENT ON TABLE public."班表" IS '辦公室與錄音室排班。取消班次是本人當次操作，只刪該人該格。';
