/** 勞報收據 PDF 匯出（逐頁截圖，避開 oklab／跨域圖／錯誤分頁） */

import { exportElementToPdfSafe, prepareDomForHtml2Canvas } from "@/lib/pdf/html2pdf-safe";

/** A4 寬度 px（96dpi）：210mm ≈ 794px；高度 297mm ≈ 1123px */
const A4_WIDTH_PX = 794;
const A4_HEIGHT_PX = 1123;

/**
 * 優先：逐頁 html2canvas + jsPDF（分頁最準）
 * 後備：整份 html2pdf（仍含 oklab 防護）
 */
export async function exportLaborReceiptsPdf(root: HTMLElement, filename: string): Promise<void> {
  const pages = Array.from(root.querySelectorAll<HTMLElement>(".labor-receipt-a4-page"));
  if (pages.length === 0) {
    await exportElementToPdfSafe({
      root,
      filename,
      margin: [0, 0, 0, 0],
      backgroundColor: "#ffffff",
      captureWidthPx: A4_WIDTH_PX,
      imageQuality: 0.95,
    });
    return;
  }

  try {
    await exportLaborReceiptsPdfByPages(root, pages, filename);
  } catch (firstErr) {
    console.warn("labor receipt page-by-page PDF failed, fallback html2pdf", firstErr);
    await exportElementToPdfSafe({
      root,
      filename,
      margin: [0, 0, 0, 0],
      backgroundColor: "#ffffff",
      captureWidthPx: A4_WIDTH_PX,
      pagebreak: { mode: ["css", "legacy"], after: ".labor-receipt-a4-page" },
      imageQuality: 0.95,
    });
  }
}

async function exportLaborReceiptsPdfByPages(
  root: HTMLElement,
  pages: HTMLElement[],
  filename: string
): Promise<void> {
  const html2canvas = (await import("html2canvas")).default;
  const { jsPDF } = await import("jspdf");

  const pageStyleBackups: { el: HTMLElement; style: string | null }[] = [];
  for (const page of pages) {
    pageStyleBackups.push({ el: page, style: page.getAttribute("style") });
    page.style.width = `${A4_WIDTH_PX}px`;
    page.style.maxWidth = `${A4_WIDTH_PX}px`;
    page.style.minHeight = `${A4_HEIGHT_PX}px`;
    page.style.height = `${A4_HEIGHT_PX}px`;
    page.style.margin = "0";
    page.style.boxShadow = "none";
    page.style.overflow = "hidden";
    page.style.background = "#ffffff";
  }

  const restore = await prepareDomForHtml2Canvas(root, { captureWidthPx: A4_WIDTH_PX });

  try {
    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i]!;
      const canvas = await html2canvas(page, {
        scale: 2,
        useCORS: true,
        allowTaint: false,
        logging: false,
        backgroundColor: "#ffffff",
        width: A4_WIDTH_PX,
        windowWidth: A4_WIDTH_PX,
      });
      const img = canvas.toDataURL("image/jpeg", 0.95);
      if (i > 0) pdf.addPage();
      pdf.addImage(img, "JPEG", 0, 0, 210, 297);
    }
    pdf.save(filename);
  } finally {
    restore();
    for (const { el, style } of pageStyleBackups) {
      if (style == null) el.removeAttribute("style");
      else el.setAttribute("style", style);
    }
  }
}

export function laborReceiptPdfFilename(kolName: string, projectId: string): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const safeKol = String(kolName || "KOL").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 24);
  const safePid = String(projectId || "").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 40);
  return `SDH-勞報收據-${safeKol}-${safePid}-${y}${m}${day}.pdf`;
}
