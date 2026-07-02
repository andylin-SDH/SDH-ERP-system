/** SDH 收款帳戶（收款表單固定顯示） */
export const SDH_COLLECTION_BANK = {
  戶名: "盛德好股份有限公司",
  銀行: "國泰世華銀行",
  分行: "士林分行 (013)",
  帳號: "068-03-500554-8",
} as const;

export function formatBankInfoLines(): string[] {
  return [
    `戶名：${SDH_COLLECTION_BANK.戶名}`,
    `${SDH_COLLECTION_BANK.銀行} ${SDH_COLLECTION_BANK.分行}`,
    `帳號：${SDH_COLLECTION_BANK.帳號}`,
  ];
}
