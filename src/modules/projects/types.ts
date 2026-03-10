/**
 * 專案模組型別
 * 對應 DB 表「專案」的欄位（僅此 7 欄）
 */

export interface ProjectRow {
  專案ID?: string;
  專案名稱?: string;
  專案類型?: string;
  專案狀態?: string;
  開案日期?: string;
  狀態確認日期?: string;
  備註?: string;
}
