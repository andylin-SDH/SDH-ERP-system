/** KOL 入口 API／畫面共用（無 server 依賴） */
export interface KolPortalProject {
  專案ID: string;
  專案名稱: string;
  專案狀態: string;
  專案總金額未稅: string;
  KOL費用未稅: string;
  款項進度: string;
  廠商付款日期: string;
  員工分潤日期: string;
  發票已開未稅合計: string;
  發票筆數: number;
}
