/**
 * Google Sheets API 客戶端
 * 所有試算表讀寫由此模組統一處理
 */

import { google } from "googleapis";
import path from "path";

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const CREDENTIALS_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS;

function getAuthClient() {
  if (!CREDENTIALS_PATH) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS 未設定");
  }
  // 支援絕對路徑與相對路徑
  const credentialsPath = path.isAbsolute(CREDENTIALS_PATH)
    ? CREDENTIALS_PATH
    : path.resolve(process.cwd(), CREDENTIALS_PATH);

  const auth = new google.auth.GoogleAuth({
    keyFile: credentialsPath,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return auth;
}

/**
 * 取得 Google Sheets API  instance
 */
export function getSheetsClient() {
  if (!SPREADSHEET_ID) {
    throw new Error("GOOGLE_SHEET_ID 未設定");
  }

  const auth = getAuthClient();
  return google.sheets({ version: "v4", auth });
}

/**
 * 取得大總表 ID
 */
export function getSpreadsheetId(): string {
  if (!SPREADSHEET_ID) {
    throw new Error("GOOGLE_SHEET_ID 未設定");
  }
  return SPREADSHEET_ID;
}

/**
 * 讀取工作表資料
 * @param sheetName 工作表名稱
 * @param range 範圍，例：A1:D10，若省略則讀取整個工作表
 */
export async function readSheet(
  sheetName: string,
  range?: string
): Promise<string[][]> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const rangeStr = range ? `${sheetName}!${range}` : sheetName;
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: rangeStr,
  });

  const values = response.data.values;
  return values ?? [];
}

/**
 * 寫入工作表（新增一列）
 * @param sheetName 工作表名稱
 * @param row 要寫入的資料列（一維陣列）
 */
export async function appendRow(
  sheetName: string,
  row: (string | number | boolean)[]
): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A:A`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [row],
    },
  });
}
