/** KOL 入口 API／畫面共用（無 server 依賴） */

import type { KolRequestMode } from "@/lib/kol/finance-status";
import type { LaborPaymentMethod } from "@/lib/kol/labor-receipt";

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
  結帳狀態: string;
  廠商付款日期: string;
  發票已開含稅合計: string;
  發票筆數: number;
  客戶端發票: KolPortalClientInvoice[];
  請款方式: KolRequestMode;
  KOL發票號碼: string;
  KOL發票日期: string;
  KOL發票備註: string;
  勞務期間起: string;
  勞務期間迄: string;
  勞務內容: string;
  給付總額: string;
  身分證字號: string;
  勞報領款方式: LaborPaymentMethod;
  聯絡電話: string;
  戶籍地址: string;
  扣繳稅額: string;
  二代健保費: string;
  實領金額: string;
  勞報簽署時間: string;
  勞報簽名: string;
  請款憑證摘要: string;
  KOL發票填寫來源: string;
  KOL發票填寫人: string;
  KOL匯款日期: string;
  KOL匯款金額: string;
  canEditKolInvoice: boolean;
}
