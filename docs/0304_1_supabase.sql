-- 0304_1.sql 的 Supabase 相容版
-- 可在 Supabase Dashboard > SQL Editor 執行
-- 若要重建表，可把下方 DROP 區塊取消註解（會刪光資料）

-- DROP TABLE IF EXISTS "分潤表" CASCADE;
-- DROP TABLE IF EXISTS "任務" CASCADE;
-- DROP TABLE IF EXISTS "財務" CASCADE;
-- DROP TABLE IF EXISTS "發票" CASCADE;
-- DROP TABLE IF EXISTS "專案" CASCADE;
-- DROP TABLE IF EXISTS "大總表" CASCADE;
-- DROP TABLE IF EXISTS "users" CASCADE;

-- ========== users ==========
-- 若專案已用 001_initial_schema 的 users（email/password），請略過此段
CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "帳號" text UNIQUE NOT NULL,
  "姓名" text NOT NULL,
  "角色" text NOT NULL,
  "部門" text,
  "scope" text,
  "密碼" text NOT NULL,
  "active_flag" boolean DEFAULT true,
  "created_at" timestamptz DEFAULT now()
);

COMMENT ON TABLE "users" IS '使用者（帳號、角色、Scope），不更動';

-- ========== 大總表（中心主題） ==========
CREATE TABLE IF NOT EXISTS "大總表" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "專案ID" text UNIQUE NOT NULL,
  "專案名稱" text,
  "專案類型" text,
  "專案狀態" text,
  "狀態確認日期" text,
  "開案日期" text,
  "專案總金額未稅" text,
  "專案營收" text,
  "專案成本" text,
  "KOL費用未稅" text,
  "KOL名稱" text,
  "專案費用類型" text,
  "廠商名稱" text,
  "專案內容" text,
  "備註" text,
  "專案BDPM" text,
  "專案引薦人" text,
  "專案管理員" text,
  "執行管理員" text,
  "專案資料夾" text,
  "專案引薦人分潤成數" text,
  "專案管理員分潤成數" text,
  "執行管理員分潤成數" text,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);

COMMENT ON TABLE "大總表" IS '大總表（中心主題）；專案、分潤表、任務、財務、發票皆在其下';

CREATE INDEX IF NOT EXISTS idx_大總表_專案ID ON "大總表"("專案ID");

-- ========== 專案（隸屬大總表，一筆大總表一筆專案） ==========
CREATE TABLE IF NOT EXISTS "專案" (
  "專案ID" text PRIMARY KEY,
  "專案名稱" text,
  "專案類型" text,
  "專案狀態" text,
  "狀態確認日期" text,
  "開案日期" text,
  "備註" text,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now(),
  CONSTRAINT fk_專案_大總表 FOREIGN KEY ("專案ID") REFERENCES "大總表"("專案ID") ON DELETE CASCADE
);

COMMENT ON TABLE "專案" IS '專案表（under 大總表；依 專案ID 關聯大總表）';

CREATE INDEX IF NOT EXISTS idx_專案_專案ID ON "專案"("專案ID");

-- ========== 分潤表 ==========
CREATE TABLE IF NOT EXISTS "分潤表" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "專案ID" text NOT NULL,
  "專案名稱" text,
  "專案總金額未稅" text,
  "角色" text NOT NULL,
  "分潤成數" text,
  "分潤金額" text,
  "領取人" text,
  "created_at" timestamptz DEFAULT now()
);

COMMENT ON TABLE "分潤表" IS '角色分潤（成數由大總表帶入）';

ALTER TABLE "分潤表" ADD CONSTRAINT fk_分潤表_專案ID
  FOREIGN KEY ("專案ID") REFERENCES "大總表"("專案ID") ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_分潤表_專案ID ON "分潤表"("專案ID");
CREATE UNIQUE INDEX IF NOT EXISTS idx_分潤表_專案ID_角色 ON "分潤表"("專案ID", "角色");

-- ========== 任務 ==========
CREATE TABLE IF NOT EXISTS "任務" (
  "任務ID" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "專案ID" text NOT NULL,
  "任務名稱" text,
  "任務狀態" text,
  "負責人" text,
  "備註" text,
  "created_at" timestamptz DEFAULT now()
);

COMMENT ON TABLE "任務" IS '任務（依專案ID 連動大總表）';

ALTER TABLE "任務" ADD CONSTRAINT fk_任務_專案ID
  FOREIGN KEY ("專案ID") REFERENCES "大總表"("專案ID") ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_任務_專案ID ON "任務"("專案ID");

-- ========== 財務 ==========
CREATE TABLE IF NOT EXISTS "財務" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "專案ID" text NOT NULL,
  "專案總金額未稅" text,
  "專案成本" text,
  "專案實際成本" text,
  "專案分潤" text,
  "專案利潤" text,
  "專案利潤比" text,
  "發票號碼" text,
  "廠商付款狀態" text,
  "員工分潤狀態" text,
  "created_at" timestamptz DEFAULT now()
);

COMMENT ON TABLE "財務" IS '財務（依專案ID 連動大總表）';

ALTER TABLE "財務" ADD CONSTRAINT fk_財務_專案ID
  FOREIGN KEY ("專案ID") REFERENCES "大總表"("專案ID") ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_財務_專案ID ON "財務"("專案ID");

-- ========== 發票 ==========
CREATE TABLE IF NOT EXISTS "發票" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "專案ID" text NOT NULL,
  "發票號碼" text,
  "發票日期" text,
  "發票金額未稅" text,
  "發票金額含稅" text,
  "發票稅金" text,
  "廠商預計付款日" text,
  "廠商實付金額" text,
  "廠商付款狀態" text,
  "廠商付款日期" text,
  "備註" text,
  "created_at" timestamptz DEFAULT now()
);

COMMENT ON TABLE "發票" IS '廠商（發票與付款）';

ALTER TABLE "發票" ADD CONSTRAINT fk_發票_專案ID
  FOREIGN KEY ("專案ID") REFERENCES "大總表"("專案ID") ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_發票_專案ID ON "發票"("專案ID");
