/**
 * html2pdf / html2canvas 安全匯出
 * Tailwind v4 的 lab/oklab/oklch 會讓舊版 html2canvas 炸掉：
 * 1) 內嵌樣式時把現代色碼轉成 rgb
 * 2) 暫時移除 stylesheet，避免再解析到 lab
 */

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
  "outline",
  "outline-color",
  "font-size",
  "font-weight",
  "font-family",
  "line-height",
  "letter-spacing",
  "text-align",
  "text-decoration-color",
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
  "table-layout",
  "border-collapse",
] as const;

const MODERN_COLOR_FN_RE = /(?:ok)?lab\(|(?:ok)?lch\(|color-mix\(|color\(/i;

let measureCtx: CanvasRenderingContext2D | null | undefined;

function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (measureCtx !== undefined) return measureCtx;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    measureCtx = canvas.getContext("2d", { willReadFrequently: true });
  } catch {
    measureCtx = null;
  }
  return measureCtx;
}

/** 把 lab/oklab/oklch/color() 轉成 rgb／hex（舊 html2canvas 才讀得懂） */
export function cssColorToRgb(cssColor: string): string {
  const v = String(cssColor ?? "").trim();
  if (!v || v === "none" || v === "transparent" || v === "currentcolor") return v;
  if (!MODERN_COLOR_FN_RE.test(v)) return v;
  const ctx = getMeasureCtx();
  if (!ctx) return "rgb(0, 0, 0)";
  try {
    ctx.fillStyle = "#000000";
    ctx.fillStyle = v;
    const normalized = String(ctx.fillStyle || "");
    if (normalized && !MODERN_COLOR_FN_RE.test(normalized)) return normalized;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    const a = (d[3] ?? 255) / 255;
    if (a >= 0.999) return `rgb(${d[0]}, ${d[1]}, ${d[2]})`;
    return `rgba(${d[0]}, ${d[1]}, ${d[2]}, ${Number(a.toFixed(4))})`;
  } catch {
    return "rgb(0, 0, 0)";
  }
}

function replaceModernColorsInCssValue(value: string): string {
  if (!MODERN_COLOR_FN_RE.test(value)) return value;
  const re = /((?:ok)?lab|(?:ok)?lch|color-mix|color)\(/gi;
  let result = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value))) {
    const start = m.index;
    let i = start + m[0].length;
    let depth = 1;
    while (i < value.length && depth > 0) {
      const ch = value[i];
      if (ch === "(") depth += 1;
      else if (ch === ")") depth -= 1;
      i += 1;
    }
    const fn = value.slice(start, i);
    result += value.slice(last, start) + cssColorToRgb(fn);
    last = i;
    re.lastIndex = i;
  }
  result += value.slice(last);
  return result;
}

function sanitizeCssValue(prop: string, value: string): string {
  if (!value) return value;
  if (!MODERN_COLOR_FN_RE.test(value)) return value;
  if (
    prop === "color" ||
    prop.endsWith("-color") ||
    prop === "background-color" ||
    prop === "border-color" ||
    prop === "outline-color" ||
    prop === "text-decoration-color"
  ) {
    return cssColorToRgb(value);
  }
  return replaceModernColorsInCssValue(value);
}

function copyComputedStyles(source: HTMLElement, target: HTMLElement): void {
  const computed = window.getComputedStyle(source);
  for (const prop of INLINE_STYLE_PROPS) {
    const raw = computed.getPropertyValue(prop);
    if (!raw) continue;
    target.style.setProperty(prop, sanitizeCssValue(prop, raw));
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

async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("讀取圖片失敗"));
    reader.readAsDataURL(blob);
  });
}

/** 遠端圖轉 data URL，避免 CORS／tainted canvas 導致 PDF 空白或失敗 */
export async function inlineImagesAsDataUrls(root: HTMLElement): Promise<() => void> {
  const backups: { img: HTMLImageElement; src: string }[] = [];
  const imgs = Array.from(root.querySelectorAll("img"));
  await Promise.all(
    imgs.map(async (img) => {
      const src = String(img.currentSrc || img.src || "").trim();
      if (!src || src.startsWith("data:") || src.startsWith("blob:")) return;
      backups.push({ img, src });
      try {
        const res = await fetch(src, { mode: "cors", credentials: "omit", cache: "force-cache" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const dataUrl = await blobToDataUrl(await res.blob());
        if (dataUrl.startsWith("data:")) {
          img.removeAttribute("crossorigin");
          img.src = dataUrl;
          await img.decode().catch(() => undefined);
        }
      } catch {
        // 保留原圖；若跨域失敗，PDF 可能缺該圖但仍應能產生檔案
      }
    })
  );
  return () => {
    for (const { img, src } of backups) img.src = src;
  };
}

/** 準備 DOM 給 html2canvas（lab／oklab 防護）；回傳還原函式 */
export async function prepareDomForHtml2Canvas(
  root: HTMLElement,
  opts?: { hideSelectors?: string[]; captureWidthPx?: number }
): Promise<() => void> {
  const hideSelectors = opts?.hideSelectors ?? [".no-print"];
  const untag = tagElementsForPdfExport(root);

  const hidden: { el: HTMLElement; display: string }[] = [];
  for (const sel of hideSelectors) {
    for (const node of root.querySelectorAll<HTMLElement>(sel)) {
      hidden.push({ el: node, display: node.style.display });
      node.style.display = "none";
    }
  }

  const prevWidth = root.style.width;
  const prevMaxWidth = root.style.maxWidth;
  if (opts?.captureWidthPx != null) {
    root.style.width = `${opts.captureWidthPx}px`;
    root.style.maxWidth = `${opts.captureWidthPx}px`;
  }

  const restoreImages = await inlineImagesAsDataUrls(root);
  // 先內嵌並把 lab→rgb，再移除 stylesheet，避免 html2canvas 再解析到現代色碼
  const restoreStyles = inlineCaptureStyles(root);
  const restoreStylesheets = suspendDocumentStylesheets();

  return () => {
    if (opts?.captureWidthPx != null) {
      root.style.width = prevWidth;
      root.style.maxWidth = prevMaxWidth;
    }
    for (const { el, display } of hidden) {
      el.style.display = display;
    }
    restoreStyles();
    restoreStylesheets();
    restoreImages();
    untag();
  };
}

export type SafeHtml2PdfOptions = {
  root: HTMLElement;
  filename: string;
  margin?: number | number[];
  backgroundColor?: string;
  /** 匯出時強制根節點寬度（px），建議 A4 ≈ 794 */
  captureWidthPx?: number;
  hideSelectors?: string[];
  pagebreak?: {
    mode?: string | string[];
    before?: string | string[];
    after?: string | string[];
    avoid?: string | string[];
  };
  imageQuality?: number;
};

export async function exportElementToPdfSafe(opts: SafeHtml2PdfOptions): Promise<void> {
  const {
    root,
    filename,
    margin = [0, 0, 0, 0],
    backgroundColor = "#ffffff",
    captureWidthPx,
    hideSelectors = [".no-print"],
    pagebreak,
    imageQuality = 0.95,
  } = opts;

  const html2pdf = (await import("html2pdf.js")).default;
  const restore = await prepareDomForHtml2Canvas(root, { hideSelectors, captureWidthPx });

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (html2pdf() as any)
      .set({
        margin,
        filename,
        image: { type: "jpeg", quality: imageQuality },
        html2canvas: {
          scale: 2,
          useCORS: true,
          allowTaint: false,
          logging: false,
          backgroundColor,
          onclone: (clonedDoc: Document, clonedRoot: Element) => {
            if (clonedRoot instanceof HTMLElement) {
              syncClonedStyles(root, clonedDoc, clonedRoot);
            }
          },
        },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        ...(pagebreak ? { pagebreak } : {}),
      })
      .from(root)
      .save();
  } finally {
    restore();
  }
}
