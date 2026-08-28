/**
 * KOL 入口用：四階段結帳狀態（與內部員工分潤無關）
 * 未入帳 → 可請款 → 待匯款 → 已匯款
 */

export type KolRequestMode = "發票" | "勞務報酬";

export type KolRequestCredential = {
  請款方式?: string | null;
  KOL發票號碼?: string | null;
  勞務期間起?: string | null;
  勞務期間迄?: string | null;
  勞務內容?: string | null;
  給付總額?: string | null;
  身分證字號?: string | null;
  領款方式?: string | null;
  聯絡電話?: string | null;
  戶籍地址?: string | null;
  扣繳稅額?: string | null;
  二代健保費?: string | null;
  實領金額?: string | null;
  勞報簽署時間?: string | null;
  勞報簽名?: string | null;
};

export function kolRequestMode(kol?: KolRequestCredential | null): KolRequestMode {
  return String(kol?.請款方式 ?? "").trim() === "勞務報酬" ? "勞務報酬" : "發票";
}

/** 請款憑證是否已齊（發票號碼 或 勞報已簽署） */
export function kolHasRequestCredential(kol?: KolRequestCredential | null): boolean {
  if (!kol) return false;
  if (kolRequestMode(kol) === "勞務報酬") {
    return Boolean(
      String(kol.勞務期間起 ?? "").trim() &&
        String(kol.勞務期間迄 ?? "").trim() &&
        String(kol.勞務內容 ?? "").trim() &&
        String(kol.給付總額 ?? "").trim() &&
        String(kol.身分證字號 ?? "").trim() &&
        String(kol.聯絡電話 ?? "").trim() &&
        String(kol.戶籍地址 ?? "").trim() &&
        String(kol.勞報簽署時間 ?? "").trim()
    );
  }
  return Boolean(String(kol.KOL發票號碼 ?? "").trim());
}

/** 財務已填客戶入帳日（廠商付款日期） */
export function kolClientHasCredited(廠商付款日期?: string | null): boolean {
  return Boolean(String(廠商付款日期 ?? "").trim());
}

export function kolFinanceProgressShort(
  廠商付款日期?: string | null,
  kol?: KolRequestCredential | null,
  KOL匯款日期?: string | null
): string {
  const remitted = String(KOL匯款日期 ?? "").trim();
  /** 已匯款優先：支援代墊（廠商尚未入帳但公司已匯出）顯示，不開請款閘 */
  if (remitted) return "已匯款";
  const vendorPaid = kolClientHasCredited(廠商付款日期);
  if (!vendorPaid) return "未入帳";
  if (!kolHasRequestCredential(kol)) return "可請款";
  return "待匯款";
}

/** KOL 是否可填寫／修改請款憑證（需客戶已入帳且尚未匯款；代墊已匯款亦不可再請） */
export function kolCanEditRequestCredential(
  廠商付款日期?: string | null,
  kol?: KolRequestCredential | null,
  KOL匯款日期?: string | null
): boolean {
  if (String(KOL匯款日期 ?? "").trim()) return false;
  if (!kolClientHasCredited(廠商付款日期)) return false;
  return kolFinanceProgressShort(廠商付款日期, kol, KOL匯款日期) !== "已匯款";
}

/** 列表顯示用：請款憑證摘要 */
export function kolRequestCredentialLabel(kol?: KolRequestCredential | null): string {
  if (!kol) return "";
  if (kolRequestMode(kol) === "勞務報酬") {
    if (!String(kol.勞報簽署時間 ?? "").trim()) return "";
    return "勞務報酬單";
  }
  return String(kol.KOL發票號碼 ?? "").trim();
}
