import type { BankImportRow } from "@/lib/reconciliation/types";

export interface ParsedBankCsv {
  rows: BankImportRow[];
  headers: string[];
  errors: string[];
  encoding: "UTF-8" | "Big5";
}

function parseCsvRecords(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field.trim());
      field = "";
    } else if (char === "\n") {
      row.push(field.trim());
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") field += char;
  }
  row.push(field.trim());
  if (row.some((cell) => cell !== "")) rows.push(row);
  return rows;
}

function normalizeHeader(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\s_（）()／/.-]/g, "");
}

function headerIndex(headers: string[], aliases: string[]): number {
  const normalized = headers.map(normalizeHeader);
  const aliasSet = aliases.map(normalizeHeader);
  for (const alias of aliasSet) {
    const exact = normalized.indexOf(alias);
    if (exact >= 0) return exact;
  }
  return normalized.findIndex((header) => aliasSet.some((alias) => header.includes(alias)));
}

function parseNumber(value: string): number | null {
  const raw = value.normalize("NFKC").trim();
  if (!raw) return null;
  const negativeByParentheses = raw.startsWith("(") && raw.endsWith(")");
  const number = Number(raw.replace(/[,\s$NTD元()]/gi, ""));
  if (!Number.isFinite(number)) return null;
  return negativeByParentheses ? -Math.abs(number) : number;
}

function normalizeDate(value: string): string {
  const raw = value.normalize("NFKC").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  let year = 0;
  let month = 0;
  let day = 0;
  if (digits.length === 8) {
    year = Number(digits.slice(0, 4));
    month = Number(digits.slice(4, 6));
    day = Number(digits.slice(6, 8));
  } else if (digits.length === 7) {
    year = Number(digits.slice(0, 3)) + 1911;
    month = Number(digits.slice(3, 5));
    day = Number(digits.slice(5, 7));
  } else {
    const parts = raw.split(/[-/.]/).map((part) => Number(part));
    if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) return raw;
    year = parts[0] < 1911 ? parts[0] + 1911 : parts[0];
    month = parts[1];
    day = parts[2];
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function decodeBest(buffer: ArrayBuffer): { text: string; encoding: "UTF-8" | "Big5" } {
  const utf8 = new TextDecoder("utf-8").decode(buffer);
  const big5 = new TextDecoder("big5").decode(buffer);
  const score = (text: string) => {
    const keywords = ["交易日期", "入帳日期", "金額", "摘要", "帳號", "匯款"];
    return keywords.reduce((total, keyword) => total + (text.includes(keyword) ? 10 : 0), 0) - (text.match(/�/g)?.length ?? 0);
  };
  return score(big5) > score(utf8) ? { text: big5, encoding: "Big5" } : { text: utf8, encoding: "UTF-8" };
}

export function parseBankCsv(buffer: ArrayBuffer): ParsedBankCsv {
  const decoded = decodeBest(buffer);
  const records = parseCsvRecords(decoded.text.replace(/^\uFEFF/, ""));
  const errors: string[] = [];
  if (records.length === 0) return { rows: [], headers: [], errors: ["檔案是空的"], encoding: decoded.encoding };

  const dateAliases = ["交易日期", "帳務日期", "轉帳日期", "日期"];
  const amountAliases = ["交易金額", "入帳金額", "金額", "存入金額", "貸方金額"];
  const creditAliases = ["存入金額", "存款金額", "收入金額", "貸方金額", "轉入金額"];
  const debitAliases = ["支出金額", "提款金額", "借方金額", "轉出金額"];
  const headerRowIndex = records.findIndex((row) => {
    const hasDate = headerIndex(row, dateAliases) >= 0;
    const hasAmount = headerIndex(row, [...amountAliases, ...creditAliases, ...debitAliases]) >= 0;
    return hasDate && hasAmount;
  });
  if (headerRowIndex < 0) {
    return {
      rows: [],
      headers: records[0] ?? [],
      errors: ["找不到交易日期與金額欄位；需要依國泰實際 CSV 欄位調整一次"],
      encoding: decoded.encoding,
    };
  }

  const headers = records[headerRowIndex];
  const indexes = {
    date: headerIndex(headers, dateAliases),
    bookingDate: headerIndex(headers, ["入帳日期", "入帳日", "起息日"]),
    amount: headerIndex(headers, amountAliases),
    credit: headerIndex(headers, creditAliases),
    debit: headerIndex(headers, debitAliases),
    direction: headerIndex(headers, ["借貸別", "收支別", "交易方向", "交易類型"]),
    name: headerIndex(headers, ["匯款人", "匯款戶名", "對方戶名", "交易對象", "轉帳戶名"]),
    account: headerIndex(headers, ["匯款帳號", "對方帳號", "轉出帳號", "交易帳號"]),
    last5: headerIndex(headers, ["匯款末五碼", "帳號末五碼", "末五碼"]),
    description: headerIndex(headers, ["交易摘要", "摘要", "交易說明", "說明", "備註"]),
    reference: headerIndex(headers, ["交易序號", "交易編號", "參考號碼", "流水號", "序號"]),
    currency: headerIndex(headers, ["幣別", "交易幣別"]),
    sourceAccount: headerIndex(headers, ["本行帳號", "帳戶號碼", "查詢帳號"]),
  };

  const valueAt = (record: string[], index: number) => (index >= 0 ? String(record[index] ?? "").trim() : "");
  const rows: BankImportRow[] = [];
  for (let i = headerRowIndex + 1; i < records.length; i += 1) {
    const record = records[i];
    const transactionDate = normalizeDate(valueAt(record, indexes.date));
    const credit = parseNumber(valueAt(record, indexes.credit));
    const debit = parseNumber(valueAt(record, indexes.debit));
    const general = parseNumber(valueAt(record, indexes.amount));
    const directionText = normalizeHeader(valueAt(record, indexes.direction));
    let direction: "credit" | "debit" = "credit";
    let amount: number | null = null;
    if (credit != null && credit !== 0) amount = Math.abs(credit);
    else if (debit != null && debit !== 0) {
      amount = Math.abs(debit);
      direction = "debit";
    } else if (general != null) {
      amount = Math.abs(general);
      direction = general < 0 ? "debit" : "credit";
    }
    if (/[支借出提款]/.test(directionText) || directionText.includes("轉出")) direction = "debit";
    if (/[收貸入存]/.test(directionText) || directionText.includes("轉入")) direction = "credit";

    if (!transactionDate && amount == null) continue;
    if (!transactionDate || amount == null || amount <= 0) {
      errors.push(`第 ${i + 1} 列：缺少有效的交易日期或金額`);
      continue;
    }
    const raw = Object.fromEntries(headers.map((header, index) => [header || `欄位${index + 1}`, record[index] ?? ""]));
    rows.push({
      transactionDate,
      bookingDate: normalizeDate(valueAt(record, indexes.bookingDate)) || null,
      amount,
      currency: valueAt(record, indexes.currency) || "TWD",
      direction,
      counterpartyName: valueAt(record, indexes.name) || null,
      counterpartyAccount: valueAt(record, indexes.account) || null,
      counterpartyLast5: valueAt(record, indexes.last5) || null,
      description: valueAt(record, indexes.description) || null,
      bankReference: valueAt(record, indexes.reference) || null,
      sourceAccount: valueAt(record, indexes.sourceAccount) || null,
      raw,
    });
  }
  return { rows, headers, errors: errors.slice(0, 50), encoding: decoded.encoding };
}
