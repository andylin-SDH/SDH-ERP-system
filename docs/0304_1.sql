CREATE TABLE "users" (
  "id" uuid PRIMARY KEY DEFAULT (gen_random_uuid()),
  "帳號" text UNIQUE NOT NULL,
  "姓名" text NOT NULL,
  "角色" text NOT NULL,
  "部門" text,
  "scope" text,
  "密碼" text NOT NULL,
  "active_flag" boolean DEFAULT true,
  "created_at" timestamptz DEFAULT (now())
);

CREATE TABLE "大總表" (
  "id" uuid PRIMARY KEY DEFAULT (gen_random_uuid()),
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
  "created_at" timestamptz DEFAULT (now()),
  "updated_at" timestamptz DEFAULT (now())
);

CREATE TABLE "分潤表" (
  "id" uuid PRIMARY KEY DEFAULT (gen_random_uuid()),
  "專案ID" text NOT NULL,
  "專案名稱" text,
  "專案總金額未稅" text,
  "角色" text NOT NULL,
  "分潤成數" text,
  "分潤金額" text,
  "領取人" text,
  "created_at" timestamptz DEFAULT (now())
);

CREATE TABLE "任務" (
  "任務ID" uuid PRIMARY KEY DEFAULT (gen_random_uuid()),
  "專案ID" text NOT NULL,
  "任務名稱" text,
  "任務類型" text,
  "負責人" text,
  "備註" text,
  "created_at" timestamptz DEFAULT (now())
);

CREATE TABLE "財務" (
  "id" uuid PRIMARY KEY DEFAULT (gen_random_uuid()),
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
  "created_at" timestamptz DEFAULT (now())
);

CREATE TABLE "發票" (
  "id" uuid PRIMARY KEY DEFAULT (gen_random_uuid()),
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
  "created_at" timestamptz DEFAULT (now())
);

COMMENT ON TABLE "users" IS '使用者（帳號、角色、Scope），不更動';

COMMENT ON TABLE "大總表" IS '大總表（中心主題）';

COMMENT ON TABLE "任務" IS '任務（含 Partner 欄位）';

COMMENT ON TABLE "財務" IS '財務';

COMMENT ON TABLE "發票" IS '廠商（發票與付款）';

ALTER TABLE "分潤表" ADD FOREIGN KEY ("專案ID") REFERENCES "大總表" ("專案ID") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "分潤表" ADD FOREIGN KEY ("專案名稱") REFERENCES "大總表" ("專案名稱") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "分潤表" ADD FOREIGN KEY ("專案總金額未稅") REFERENCES "大總表" ("專案總金額未稅") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "任務" ADD FOREIGN KEY ("專案ID") REFERENCES "大總表" ("專案ID") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "財務" ADD FOREIGN KEY ("專案ID") REFERENCES "大總表" ("專案ID") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "財務" ADD FOREIGN KEY ("專案成本") REFERENCES "大總表" ("專案成本") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "財務" ADD FOREIGN KEY ("發票號碼") REFERENCES "發票" ("發票號碼") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "財務" ADD FOREIGN KEY ("廠商付款狀態") REFERENCES "發票" ("廠商付款狀態") DEFERRABLE INITIALLY IMMEDIATE;
