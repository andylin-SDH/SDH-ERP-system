/**
 * 前端匯出 Excel 可開的試算表（UTF-8 BOM CSV）。
 * 不引入 xlsx 套件，Excel／Numbers／Google 試算表皆可開啟。
 */

export type ExcelCell = string | number | null | undefined;

function escapeCsvCell(value: ExcelCell): string {
  if (value == null) return "";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function stampForFilename(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/** 下載 UTF-8 BOM CSV（副檔名 .csv，Excel 可直接開啟） */
export function downloadTableAsExcelCsv(opts: {
  filenameBase: string;
  headers: string[];
  rows: ExcelCell[][];
}): void {
  const { filenameBase, headers, rows } = opts;
  if (typeof document === "undefined") return;
  const lines = [
    headers.map(escapeCsvCell).join(","),
    ...rows.map((row) => row.map(escapeCsvCell).join(",")),
  ];
  const bom = "\uFEFF";
  const blob = new Blob([bom + lines.join("\r\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filenameBase}_${stampForFilename()}.csv`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
