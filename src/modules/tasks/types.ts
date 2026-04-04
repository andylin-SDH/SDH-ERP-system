/**
 * 任務模組型別
 * 對應大總表 Tasks 工作表
 */

export interface TaskRow {
  任務ID?: string;
  專案ID?: string;
  專案名稱?: string;
  任務?: string;
  任務類型?: string;
  任務負責人?: string;
  /** 系統於建立任務時寫入（ISO 字串） */
  開始時間?: string;
  /** 系統於勾選「任務完成」時寫入；取消完成時清空 */
  完成時間?: string;
  任務完成?: boolean;
}
