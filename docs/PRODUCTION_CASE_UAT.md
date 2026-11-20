# 製作控管 UAT

## 套用 DB

在 Supabase SQL Editor 執行：

`supabase/migrations/085_production_case.sql`

## 從 iCue Cue 表批次匯入（多專案）

1. 每個專案匯出／備一份同格式 CSV → `data/pc-import/`
2. 在 `data/pc-import/manifest.json` 加一筆（`id`、`program_name`、`csv`、可選 `client_name`）
3. 執行：

```bash
node scripts/import-pc-cue-sheets.mjs --dry-run   # 先預覽
node scripts/import-pc-cue-sheets.mjs             # 寫入 pc_*（只新增不覆蓋）
```

範例已匯入：`iCue維思感創`（`PC-ICUE-WEITHINK`）。

## 建立測試帳號

```bash
node scripts/seed-production-case-users.mjs
```


密碼（全部相同）：`PcUat2026!`

| 帳號 | 角色 | 入口 |
|------|------|------|
| pc-pm@sdh-uat.test | 製作人 | `/dashboard` → 製作控管 |
| pc-vendor@sdh-uat.test | 外包 | `/production-case/vendor` |
| pc-client@sdh-uat.test | 製作案主 | `/production-case/client` |
| pc-kol@sdh-uat.test | KOL | `/production-case/kol`（或 `/?next=/production-case/kol`） |

示範節目：`PC-DEMO-01`《週一聊聊》（階段：後製中；外包已指派多筆工單）

## 建議測程

1. PM（Dashboard → 製作控管）：推進節目階段、解鎖前置、審核通過／退修、標記上架、依服務產生工單  
2. 外包（`/production-case/vendor`）：推進進行中 → 送出交付 → 被退修後再交（看不到客戶計價）  
3. 案主（`/production-case/client`）：查看排程／進度；若階段為待開案／待案主填寫可「送出開案資料」  
4. KOL（`/production-case/kol`）：只讀相關案進度  

