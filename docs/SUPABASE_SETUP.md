# Supabase 遷移步驟

## Step 1：建立 Supabase 專案

### 1.1 註冊 / 登入

1. 前往 [supabase.com](https://supabase.com)
2. 使用 GitHub 或 Google 登入

### 1.2 建立專案

1. 點 **New Project**
2. **Organization**：選預設或新建
3. **Name**：`sdh-erp`（或自訂）
4. **Database Password**：設一組強密碼（請記住，之後要用）
5. **Region**：選 `Northeast Asia (Tokyo)` 或最近區域
6. 點 **Create new project**，等待約 2 分鐘

### 1.3 取得連線資訊

1. 專案建立完成後，左側選 **Project Settings**（齒輪圖示）
2. 選 **API**
3. 記錄以下資訊：
   - **Project URL**：例 `https://xxxxx.supabase.co`
   - **anon public** key：開頭 `eyJ...` 的長字串（前端用）
   - **service_role** key：另一串（後端用，**不要**給前端）

---

## Step 2：設定 .env.local

在專案根目錄的 `.env.local` 加入：

```
NEXT_PUBLIC_SUPABASE_URL=https://你的專案.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=你的_anon_key
SUPABASE_SERVICE_ROLE_KEY=你的_service_role_key
```

---

## Step 3：建立資料表

**必做：建立程式所需表（visibility_rules、user_visibility、system_config、partners）**

1. 在 **SQL Editor** 執行 `supabase/migrations/000_required_tables.sql`
2. 會建立：visibility_rules、user_visibility、system_config、partners（若已存在會跳過）

**方式 A：依 docs/0303_1.sql 中文表名（建議）**

1. 在 **SQL Editor** 新增查詢，複製以下任一檔的內容並執行：
   - `supabase/migrations/004_schema_0303.sql`（migration 版，會 DROP 舊表）
   - `docs/0303_1_supabase.sql`（0303_1 的 Supabase 相容版，可直接使用）
2. 會建立：`大總表`、`分潤表`、`任務`、`財務`、`發票`，全部以 **專案ID** 關聯；**users** 保留不更動。
3. 此 migration 會 DROP 舊表（partners, projects, project_master, role_payout 等）再建立新表。
4. 執行 `005_role_setting_and_recipient.sql`（分潤表 領取人）。
5. 執行 `006_payout_in_master.sql`（大總表 新增 專案BDPM分潤成數、專案引薦人分潤成數、專案管理員分潤成數、執行管理員分潤成數）。

**方式 B：舊版 schema**

1. 複製 `supabase/migrations/001_initial_schema.sql` 的內容並執行。

---

## Step 4：匯入初始資料

1. 同樣在 **SQL Editor** 新增查詢
2. 複製 `scripts/seed-users.sql` 的內容
3. 貼上後點 **Run**，建立初始使用者（Andy、維尼、Ivy）

---

## Step 4.5：建立使用者查詢函數（修復 Ivy 登入）

1. 在 **SQL Editor** 新增查詢
2. 複製 `supabase/migrations/002_user_lookup_rpc.sql` 的內容
3. 貼上後點 **Run**

---

## Step 5：Ivy 經紀人測試資料（可選）

讓經紀人 Ivy 登入後能看到合作夥伴、專案、任務範例：

1. 在 **SQL Editor** 新增查詢
2. 複製 `scripts/seed-ivy-sample.sql` 的內容
3. 貼上後點 **Run**

Ivy 登入資訊：`ivyhsu@sdh-corp.com` / `pass1234`

---

## Step 6：匯入 Partners 資料（可選）

若 Google Sheets 的 Partners 有資料，可：

1. 從 Sheets 匯出為 CSV
2. 在 Supabase 後台 **Table Editor** → **partners** → **Import data from CSV**

或手動在 Table Editor 新增資料，欄位對應：

| Partners 表欄位 | 對應 Sheets |
|-----------------|-------------|
| partner_id | PartnerID (KOL-01) |
| partner_name | PartnerName |
| partner_emails | PartnerEmails |
| responsible_agent | 負責經紀人 email |
| notes | Notes |

---

## 完成後

執行 `npm run dev`，開啟首頁登入（使用 seed 中的 email + 密碼）即可。
