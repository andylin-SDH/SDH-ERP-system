/** KOL 入口 API／畫面共用（無 server 依賴） */

export interface KolPortalClientInvoice {
  發票號碼: string;
  發票日期: string;
  發票金額含稅: string;
}

export interface KolPortalProject {
  專案ID: string;
  專案名稱: string;
  專案狀態: string;
  專案總金額未稅: string;
  KOL費用未稅: string;
  /** 依依專案財務之廠商／員工分潤日期計算（財務入帳後會變） */
  結帳狀態: string;
  廠商付款日期: string;
  /** 客戶端發票含稅加總（舊欄位，保留相容） */
  發票已開含稅合計: string;
  發票筆數: number;
  /** 客戶 → SDH 收款發票（唯讀） */
  客戶端發票: KolPortalClientInvoice[];
  /** KOL → SDH 請款發票 */
  KOL發票號碼: string;
  KOL發票日期: string;
  KOL發票備註: string;
  KOL發票填寫來源: string;
  KOL發票填寫人: string;
  /** 已分潤後 KOL 不可再改 */
  canEditKolInvoice: boolean;
}
