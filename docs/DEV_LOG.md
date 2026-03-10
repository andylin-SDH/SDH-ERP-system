# 開發 Log 與模組對照

## Log 約定

- 所有與登入、Session、Dashboard 相關的變更都加上 `log(模組名, 訊息, 資料)`。
- Log 前綴為 `[SDH][模組名]`，在 terminal 可搜尋 `[SDH]` 篩選。
- 工具：`src/lib/log.ts` 的 `log(module, message, data?)`。

## 目前撰寫中的模組

| 模組 | 路徑 | 說明 |
|------|------|------|
| **users** | `src/modules/users`、`src/lib/db/users.ts` | 登入驗證、Session（verifyCredentials、getUserByEmail） |
| **dashboard** | `src/modules/dashboard`、`src/app/dashboard/*` | 各角色 Dashboard，統一導向主 Dashboard |

## 已加 Log 的位置

- `lib/db/users.ts`：getUserByEmail、verifyCredentials（輸入、查詢筆數、找到/未找到）
- `app/api/auth/session/route.ts`：GET（cookie、email、結果）、POST（登入、成功/失敗）
