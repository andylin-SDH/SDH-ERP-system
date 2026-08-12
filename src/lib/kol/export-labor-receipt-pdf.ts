/** 勞報收據 PDF：隔離 iframe + html2canvas-pro 逐頁截圖（徹底避開 Tailwind lab 色碼） */

import { captureElementInIsolatedFrame } from "@/lib/pdf/html2pdf-safe";

/** A4 寬度 px（96dpi）：210mm ≈ 794px；高度 297mm ≈ 1123px */
const A4_WIDTH_PX = 794;
const A4_HEIGHT_PX = 1123;

export async function exportLaborReceiptsPdf(root: HTMLElement, filename: string): Promise<void> {
  const pages = Array.from(root.querySelectorAll<HTMLElement>(".labor-receipt-a4-page"));
  if (pages.length === 0) {
    const { exportElementToPdfSafe } = await import("@/lib/pdf/html2pdf-safe");
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

  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]!;
    const styleBackup = page.getAttribute("style");
    page.style.width = `${A4_WIDTH_PX}px`;
    page.style.maxWidth = `${A4_WIDTH_PX}px`;
    page.style.minHeight = `${A4_HEIGHT_PX}px`;
    page.style.height = `${A4_HEIGHT_PX}px`;
    page.style.margin = "0";
    page.style.boxShadow = "none";
    page.style.overflow = "hidden";
    page.style.background = "#ffffff";

    try {
      const canvas = await captureElementInIsolatedFrame(page, {
        widthPx: A4_WIDTH_PX,
        heightPx: A4_HEIGHT_PX,
        scale: 2,
        backgroundColor: "#ffffff",
      });
      const img = canvas.toDataURL("image/jpeg", 0.95);
      if (i > 0) pdf.addPage();
      pdf.addImage(img, "JPEG", 0, 0, 210, 297);
    } finally {
      if (styleBackup == null) page.removeAttribute("style");
      else page.setAttribute("style", styleBackup);
    }
  }

  pdf.save(filename);
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
