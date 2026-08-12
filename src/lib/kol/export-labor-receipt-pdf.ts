/** 勞報收據 PDF 匯出（html2pdf） */

export async function exportLaborReceiptsPdf(root: HTMLElement, filename: string): Promise<void> {
  const html2pdf = (await import("html2pdf.js")).default;

  const hidden: { el: HTMLElement; display: string }[] = [];
  for (const node of root.querySelectorAll<HTMLElement>(".no-print")) {
    hidden.push({ el: node, display: node.style.display });
    node.style.display = "none";
  }

  try {
    await html2pdf()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .set({
        // 兩份一頁已自訂 210×297mm，邊距改 0 避免半張被擠到下一頁
        margin: [0, 0, 0, 0],
        filename,
        image: { type: "jpeg", quality: 0.95 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          allowTaint: true,
          logging: false,
          backgroundColor: "#ffffff",
        },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        pagebreak: { mode: ["css", "legacy"] },
      } as any)
      .from(root)
      .save();
  } finally {
    for (const h of hidden) h.el.style.display = h.display;
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
