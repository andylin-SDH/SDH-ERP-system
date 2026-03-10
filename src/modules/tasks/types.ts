/**
 * 任務模組型別
 * 對應大總表 Tasks 工作表
 */

export interface TaskRow {
  任務ID?: string;
  專案ID?: string;
  專案名稱?: string;
  任務?: string;
  狀態?: string;
  任務負責人?: string;
  任務完成?: boolean;
}
