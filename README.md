# 公司內部 ERP 系統

以 Google Sheets 為資料來源的公司內部 ERP，各角色有專屬 Dashboard，依 Role + Scope 過濾顯示對應的專案、任務、分潤等資料。

## 架構

- **大總表**：Google Sheets（source、Projects、Tasks、Partners、Settlement、Invoices、StaffPayouts、BankTx、Matches、Users、Finance）
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

## 設定（待實作）

1. Google Cloud Console 啟用 Google Sheets API
2. 建立服務帳戶，下載 JSON 憑證
3. 將大總表與服務帳戶共用（編輯權限）
4. 複製 `.env.example` 為 `.env.local`，填寫試算表 ID 與憑證路徑
