# 資料可見規則 × 欄位名稱 — 避免再踩雷

## 發生過什麼事（簡短）

- `visibility_rules` 裡 `partners` 曾被寫成 `match_fields = ['負責經紀人']`。
- 實際表 `partners` **沒有**「負責經紀人」這欄，只有 **「經紀人」**。
- 篩選時用錯 key，每列讀到都是空 → **63 筆全被濾掉**，畫面像沒資料。

程式已做：**讀寫時把 `負責經紀人` 自動當成 `經紀人`**（見 `src/lib/db/visibility-rules.ts` 內 `PARTNERS_MATCH_FIELD_ALIASES`）。  
仍建議在 Supabase 把舊資料改成正確或清空（見下方 SQL）。

---

## 怎麼使用（日常）

### 1) ② 全部不勾 = 全部顯示

- 在 **可見性與權限 → ② 資料可見規則 → 合作夥伴/KOL** 全部取消勾選。
- 按 **儲存**（會寫入每個 table，避免只改到部分導致 partners 沒更新）。
- 若仍沒資料 → 用下面 Debug，不要猜。

### 2) ② 有勾 = 只顯示「該欄 = 登入姓名或帳號」的列

- 比對的是 **字串完全一致**（trim 後）：`欄位值 === me.name` 或 `=== me.email`。
- `me.name` ← Users **姓名**；`me.email` ← Users **帳號**（登入用）。
- DB 裡 `經紀人` 必須填 **克萊** 或 **claire@sdh-corp.com** 這種一致寫法，否則該列不會出現。

### 3) 有資料卻整表空白 — 用 Debug API（不要猜）

1. 用**出問題的帳號**登入同一瀏覽器。
2. 網址列打開（本機範例）：
   - `http://localhost:3000/api/debug/partners-visibility`
3. 線上則把網域換成你的站：
   - `https://你的網域/api/debug/partners-visibility`
4. 看 JSON：
   - `dbPartnersRow.match_fields`：DB 原始存什麼。
   - `rulesPartnersMatchFields`：實際拿來篩的（已含別名轉換）。
   - `partnersTotal` / `partnersFilteredCount`：有沒有進篩、篩完剩幾筆。
   - `sampleRowsMatchValues`：前 3 筆在比對欄位上的**真實字串**，對照 `user.name` / `user.email`。
5. 終端機搜尋 `[SDH][debug.partners-visibility]` 可對到同一筆請求 log。

### 4) 強制把 partners 規則清成「不篩選」（Supabase SQL）

全部顯示：

```sql
UPDATE visibility_rules
SET match_fields = '{}'::text[], updated_at = now()
WHERE table_key = 'partners';
```

要依經紀人篩（欄位名必須是表上存在的 **經紀人**）：

```sql
UPDATE visibility_rules
SET match_fields = ARRAY['經紀人']::text[], updated_at = now()
WHERE table_key = 'partners';
```

---

## 未來怎麼避免類似問題

| 做法 | 說明 |
|------|------|
| **單一來源** | 欄位名以 `src/config/table-columns.ts`（或專用 schema 檔）為準；migration seed 不要手寫和 App 不一致的名稱。 |
| **別名集中** | 歷史錯名在程式裡**一處**做對應（像現在的 `PARTNERS_MATCH_FIELD_ALIASES`），不要散在多處 if。 |
| **DO NOTHING 慎用** | 會隨產品改的預設，若用 `ON CONFLICT DO NOTHING`，舊庫永遠留錯值；可改 `DO UPDATE` 或另給一支 **019_** 這類 migration 修正。 |
| **改欄位時過清單** | 改 partners 欄位名時順手查：`TABLE_COLUMNS`、`lib/db/partners` 的 select、`visibility_rules` 是否還有舊 key。 |
| **可觀測** | 出現「有資料卻空白」先打 `/api/debug/partners-visibility`，再改 code。 |
| **全形／半形／空格** | 當成不同字元；SQL 建表後用 `information_schema.columns` 對一次名稱。 |

---

## 相關檔案

| 檔案 | 用途 |
|------|------|
| `src/lib/db/visibility-rules.ts` | 讀寫規則、正規化、partners 別名 |
| `src/app/api/debug/partners-visibility/route.ts` | Debug API |
| `src/lib/debug/partners-visibility-debug.ts` | 除錯用篩選邏輯（與 Dashboard 一致） |
| `supabase/migrations/019_visibility_rules_partners_經紀人.sql` | 清掉舊的 `負責經紀人` 用 |

---

## 一句話

**match_fields 裡的字串必須是該表真的存在的欄位名；有疑問就打 debug API，不要猜。**
