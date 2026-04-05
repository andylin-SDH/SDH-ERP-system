/**
 * 財務模組型別
 * 對應：Invoices, Finance（發票、財務）
 */

export interface InvoiceRow {
  /** DB uuid，列表 key 用 */
  id?: string;
  專案ID?: string;
  發票號碼?: string;
  發票日期?: string;
  發票金額未稅?: string;
  發票金額含稅?: string;
  發票稅金?: string;
  廠商預計付款日?: string;
  廠商實付金額?: string;
  廠商付款狀態?: string;
  廠商付款日期?: string;
  備註?: string;
  [key: string]: string | undefined;
}

export interface FinanceRow {
  專案ID?: string;
  /** 由大總表依 專案ID 對應，非 DB 財務表獨立欄位 */
  專案名稱?: string;
  專案總金額未稅?: string;
  專案成本?: string;
  專案實際成本?: string;
  專案分潤?: string;
  專案利潤?: string;
  專案利潤比?: string;
  發票號碼?: string;
  廠商付款狀態?: string;
  員工分潤狀態?: string;
  [key: string]: string | undefined;
}
