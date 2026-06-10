const PDF_EXPORT_ATTR = "data-pdf-export-id";

const INLINE_STYLE_PROPS = [
  "color",
  "background-color",
  "background-image",
  "border",
  "border-top",
  "border-right",
  "border-bottom",
  "border-left",
  "border-color",
  "border-radius",
  "border-width",
  "border-style",
  "font-size",
  "font-weight",
  "font-family",
  "line-height",
  "letter-spacing",
  "text-align",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "width",
  "height",
  "min-width",
  "min-height",
  "max-width",
  "max-height",
  "display",
  "flex",
  "flex-direction",
  "flex-wrap",
  "align-items",
  "justify-content",
  "gap",
  "grid-template-columns",
  "box-shadow",
  "opacity",
  "overflow",
  "object-fit",
  "vertical-align",
  "white-space",
  "word-break",
] as const;

function catalogPdfFilename(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `SDH-KOL-roster-${y}${m}${day}.pdf`;
}

function copyComputedStyles(source: HTMLElement, target: HTMLElement): void {
  const computed = window.getComputedStyle(source);
  for (const prop of INLINE_STYLE_PROPS) {
    const value = computed.getPropertyValue(prop);
    if (value) target.style.setProperty(prop, value);
  }
}

function tagElementsForPdfExport(root: HTMLElement): () => void {
  let seq = 0;
  const tagged: HTMLElement[] = [];
  const walk = (el: HTMLElement) => {
    el.setAttribute(PDF_EXPORT_ATTR, String(seq++));
    tagged.push(el);
    for (const child of el.children) {
      if (child instanceof HTMLElement) walk(child);
    }
  };
  walk(root);
  return () => {
    for (const el of tagged) el.removeAttribute(PDF_EXPORT_ATTR);
  };
}

function inlineCaptureStyles(root: HTMLElement): () => void {
  const backup: { el: HTMLElement; style: string | null }[] = [];
  const nodes = [root, ...root.querySelectorAll<HTMLElement>("*")];
  for (const el of nodes) {
    backup.push({ el, style: el.getAttribute("style") });
    copyComputedStyles(el, el);
  }
  return () => {
    for (const { el, style } of backup) {
      if (style == null) el.removeAttribute("style");
      else el.setAttribute("style", style);
    }
  };
}

function suspendDocumentStylesheets(): () => void {
  const removed: { node: Element; parent: Node; next: ChildNode | null }[] = [];
  for (const node of document.querySelectorAll('link[rel="stylesheet"], style')) {
    if (!node.parentNode) continue;
    removed.push({ node, parent: node.parentNode, next: node.nextSibling });
    node.parentNode.removeChild(node);
  }
  return () => {
    for (const { node, parent, next } of removed.reverse()) {
      parent.insertBefore(node, next);
    }
  };
}

function stripUnsupportedStylesheets(clonedDoc: Document): void {
  clonedDoc.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => node.remove());
}

function syncClonedStyles(root: HTMLElement, clonedDoc: Document, clonedRoot: HTMLElement): void {
  stripUnsupportedStylesheets(clonedDoc);

  const sourceById = new Map<string, HTMLElement>();
  root.querySelectorAll<HTMLElement>(`[${PDF_EXPORT_ATTR}]`).forEach((el) => {
    const id = el.getAttribute(PDF_EXPORT_ATTR);
    if (id) sourceById.set(id, el);
  });

  clonedRoot.querySelectorAll<HTMLElement>(`[${PDF_EXPORT_ATTR}]`).forEach((clone) => {
    const id = clone.getAttribute(PDF_EXPORT_ATTR);
    if (!id) return;
    const source = sourceById.get(id);
    if (source) copyComputedStyles(source, clone);
  });

  copyComputedStyles(root, clonedRoot);
}

export async function exportKolCatalogPdf(root: HTMLElement): Promise<void> {
  const html2pdf = (await import("html2pdf.js")).default;
  const untag = tagElementsForPdfExport(root);

  const hidden: { el: HTMLElement; display: string }[] = [];
  for (const node of root.querySelectorAll<HTMLElement>(".kol-catalog-screen-only, .no-print")) {
    hidden.push({ el: node, display: node.style.display });
    node.style.display = "none";
  }

  const prevWidth = root.style.width;
  const prevMaxWidth = root.style.maxWidth;
  root.style.width = "794px";
  root.style.maxWidth = "794px";

  const restoreStyles = inlineCaptureStyles(root);
  const restoreStylesheets = suspendDocumentStylesheets();

  try {
    await html2pdf()
      .set({
        margin: [8, 8, 8, 8],
        filename: catalogPdfFilename(),
        image: { type: "jpeg", quality: 0.92 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          allowTaint: false,
          logging: false,
          backgroundColor: "#faf8f5",
          onclone: (clonedDoc: Document, clonedRoot: Element) => {
            if (clonedRoot instanceof HTMLElement) {
              syncClonedStyles(root, clonedDoc, clonedRoot);
            }
          },
        },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      })
      .from(root)
      .save();
  } finally {
    root.style.width = prevWidth;
    root.style.maxWidth = prevMaxWidth;
    for (const { el, display } of hidden) {
      el.style.display = display;
    }
    restoreStyles();
    restoreStylesheets();
    untag();
  }
}
