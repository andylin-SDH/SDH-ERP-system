import { exportElementToPdfSafe } from "@/lib/pdf/html2pdf-safe";

function catalogPdfFilename(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `SDH-KOL-roster-${y}${m}${day}.pdf`;
}

export async function exportKolCatalogPdf(root: HTMLElement): Promise<void> {
  await exportElementToPdfSafe({
    root,
    filename: catalogPdfFilename(),
    margin: [8, 8, 8, 8],
    backgroundColor: "#faf8f5",
    captureWidthPx: 794,
    hideSelectors: [".kol-catalog-screen-only", ".no-print"],
    imageQuality: 0.92,
  });
}
