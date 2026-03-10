# SDH ERP 模組架構

專案採用模組化設計，各區塊可獨立開發、分區負責。

## 目錄結構

```
src/
├── lib/                    # 共用層（底層依賴）
│   ├── sheets/             # Google Sheets API
│   ├── types/              # 共用型別
│   └── utils/              # 共用工具
│
├── modules/                # 業務模組（分區開發）
│   ├── users/              # 使用者、角色、權限
│   ├── projects/           # 專案
│   ├── tasks/              # 任務
│   ├── partners/           # 合作夥伴 / KOL
│   ├── finance/            # 財務（發票、財務總表）
│   └── dashboard/          # 各角色 Dashboard
│
└── app/                    # 路由、頁面
    ├── api/                # API routes（可依模組分資料夾）
    └── ...
```

## 模組說明

| 模組 | 對應試算表 | 職責 | 依賴 |
|------|------------|------|------|
| **lib/sheets** | 全部 | Google Sheets API 連線 | - |
| **lib/types** | - | 共用型別 | - |
| **users** | Users | 使用者、Role、Scope、權限 | lib/sheets |
| **projects** | Projects | 專案資料、依 Scope 過濾 | lib/sheets, users |
| **tasks** | Tasks | 任務、依 Scope 過濾 | lib/sheets, users |
| **partners** | Partners | KOL / 合作夥伴 | lib/sheets |
| **finance** | Invoices, Finance | 財務資料 | lib/sheets |
| **dashboard** | 彙總 | 各角色 Dashboard | 全部模組 |

## API 一覽

| 路徑 | 模組 | 說明 |
|------|------|------|
| GET /api/users | users | 使用者列表 |
| GET /api/projects | projects | 專案列表 |
| GET /api/tasks | tasks | 任務列表 |
| GET /api/partners | partners | 合作夥伴 / KOL |
| GET /api/invoices | finance | 發票 |
| GET /api/finance | finance | 財務總表 |

## 經紀人 Dashboard：每位經紀人只看自己的資料

經紀人登入後會依「目前登入者」過濾，每人看到的合作夥伴、專案、任務都不同。歸屬規則：

| 資料 | 歸屬方式（滿足其一即可） |
|------|--------------------------|
| **合作夥伴** | Partners 試算表「負責經紀人」= 該經紀人 email；或 Users 試算表「Scope」填 KOL_ID 列表（逗號分隔，例：KOL-01,KOL-02） |
| **專案** | Projects「專案BD」= 該經紀人 email/姓名；或專案「KOL名稱」屬於該經紀人負責的合作夥伴 |
| **任務** | Tasks「任務負責人」= 該經紀人 email/姓名；或任務所屬專案在該經紀人的專案清單內 |

建議在 **Users** 試算表為每位經紀人填寫 **Scope**（例：`KOL-01,KOL-03,KOL-05`），或在 **Partners** 試算表加「負責經紀人」欄並填經紀人 email，專案／任務的「專案BD」「任務負責人」填對應經紀人。

## 開發順序建議

1. **lib/sheets**：先完成 Google Sheets API 連線
2. **users**：讀取 Users、Role、Scope
3. **dashboard**：董事長 Dashboard（無過濾）
4. **projects**、**tasks**：依序完成
5. **finance**：財務總表、發票

## 模組規範

- 每個模組有 `index.ts` 統一匯出
- 模組內型別放 `types.ts`
- 模組專用邏輯放 `api.ts`
- 模組內有 `README.md` 說明職責與依賴
