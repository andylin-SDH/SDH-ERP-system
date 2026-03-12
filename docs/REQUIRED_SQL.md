# SDH ERP 所需資料表對照

## 程式碼使用的表 vs Migrations

| 程式碼 `.from("...")` | 表用途 | Migration | 備註 |
|----------------------|--------|-----------|------|
| `visibility_rules` | 資料可見規則 | 017 / 000_required_tables | ② 勾選欄位符合登入者時顯示該列 |
| `user_visibility` | 使用者可見範圍 | 016 / 000_required_tables | ③ 每人可看到的 Table 與欄位 |
| `system_config` | 系統設定 | 018 / 000_required_tables | ① 角色可見區塊、分潤成數、專案類型 |
| `partners` | 合作夥伴 / KOL | **無** → 000_required_tables | 程式用英文表名 |
| `users` | 使用者 | docs/0303_1_supabase | 帳號、角色、Scope |
| `大總表` | 專案主表 | docs/0303_1_supabase | 專案資料 |
| `任務` | 任務 | docs/0303_1_supabase | 任務資料 |
| `invoices` | 發票 | **無**，docs 有 `發票` | 程式用 `invoices`，schema 為 `發票`，表名可能不符 |
| `finance` | 財務總表 | **無**，docs 有 `財務` | 程式用 `finance`，schema 為 `財務`，表名可能不符 |

## 若漏掉表會如何

- `visibility_rules` 不存在 → ② 資料可見規則 儲存 500
- `user_visibility` 不存在 → ③ 使用者可見範圍 儲存失敗
- `system_config` 不存在 → ① 角色可見區塊、分潤、專案類型 儲存後會回復預設
- `partners` 不存在 → 合作夥伴區塊為空（程式有 try/catch 回傳 []）

## 一次性建立漏掉的表

在 **Supabase Dashboard > SQL Editor** 執行：

```
supabase/migrations/000_required_tables.sql
```

會建立：`visibility_rules`、`user_visibility`、`system_config`、`partners`。

## invoices / finance 表名對應

程式碼使用 `.from("invoices")`、`.from("finance")`。若你的 schema 是 `發票`、`財務`（中文），表名會不符。

做法：
1. 建立 view：`CREATE VIEW invoices AS SELECT * FROM "發票";`（欄位需對應）
2. 或直接建 `invoices`、`finance` 表，欄位依 finance.ts 預期
3. 或改程式改用 `發票`、`財務`

## partners 新增欄位 KOL開發者

執行 migration：

`supabase/migrations/020_partners_KOL開發者.sql`

或在 SQL Editor 手動：

```sql
ALTER TABLE public.partners ADD COLUMN IF NOT EXISTS "KOL開發者" text;
```

## partners 新增欄位 合約開始日期

`supabase/migrations/021_partners_合約開始日期.sql` 或：

```sql
ALTER TABLE public.partners ADD COLUMN IF NOT EXISTS "合約開始日期" text;
```

## partners KOL 審核流程（待審核 → 董事長核准後才上主列表）

執行 `supabase/migrations/022_partners_審核.sql`，會新增：

- `審核狀態`：`待審核` | `已核准` | `已駁回`（既有列會被設成 `已核准`）
- `建立者`：送出申請的使用者 email
- `駁回理由`：駁回時選填

未執行前：經紀人 POST 可能因 insert 含未知欄位而失敗；GET 主列表仍會 fallback 全表後在記憶體篩選。

## partners 待審核送出者（已上架再編輯送審）

`supabase/migrations/023_partners_待審核送出者.sql`：已核准 KOL 被非管理者修改後會改回待審核，此欄記錄是誰送審，待審核列表才能篩給該人。
