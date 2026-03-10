# 公司內部 ERP 系統

以 Google Sheets 為資料來源的公司內部 ERP，各角色有專屬 Dashboard，依 Role + Scope 過濾顯示對應的專案、任務、分潤等資料。

## 架構

- **模組化**：採模組化設計，各區塊可獨立開發，詳見 [MODULES.md](./MODULES.md)
- **資料庫**：Supabase（PostgreSQL），支援交易、併發、財務自動化
- **ERP**：Next.js 應用程式，讀寫試算表，依使用者角色與責任範圍顯示 Dashboard
- **連動**：財務確認收款等操作，由 ERP 統一更新多個試算表

## 技術

- Next.js 16（App Router）+ TypeScript + Tailwind CSS
- Google Sheets API

## 開發

```bash
npm install
npm run dev
```

瀏覽 [http://localhost:3000](http://localhost:3000)。

## 設定

詳見 [docs/SUPABASE_SETUP.md](./docs/SUPABASE_SETUP.md)，簡要步驟：

1. 在 [supabase.com](https://supabase.com) 建立專案
2. 複製 `.env.example` 為 `.env.local`，填寫 Supabase URL 與金鑰
3. 在 Supabase SQL Editor 執行 `supabase/migrations/001_initial_schema.sql`
4. 執行 `scripts/seed-users.sql` 建立初始使用者
