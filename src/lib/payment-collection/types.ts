export interface PaymentLinkRow {
  id: string;
  專案ID: string;
  token: string;
  建立人?: string | null;
  created_at?: string;
}

export interface PaymentSubmissionRow {
  id: string;
  專案ID: string;
  連結ID?: string | null;
  匯款單位: string;
  匯款日期: string;
  匯款金額?: string | null;
  匯款末五碼: string;
  匯款帳號?: string | null;
  聯絡人?: string | null;
  聯絡Email?: string | null;
  聯絡電話?: string | null;
  備註?: string | null;
  submitted_at?: string;
}

export interface PaymentFormInvoice {
  發票號碼: string;
  發票日期: string;
  收款對象: string;
  發票金額含稅: string;
  廠商預計付款日: string;
}

export interface PaymentFormPayload {
  專案ID: string;
  專案名稱: string;
  invoices: PaymentFormInvoice[];
  發票含稅合計: string;
  bank: typeof import("./bank-info").SDH_COLLECTION_BANK;
}
