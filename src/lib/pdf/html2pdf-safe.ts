/**
 * PDF 匯出安全工具：把 lab/oklch 等現代色碼轉成 rgb，並可在隔離 iframe 截圖。
 */

const MODERN_COLOR_FN_RE = /(?:ok)?lab\(|(?:ok)?lch\(|color-mix\(|color\(/i;

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
  "text-decoration",
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
  "row-gap",
  "column-gap",
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
  "position",
  "top",
  "right",
  "bottom",
  "left",
  "z-index",
  "box-sizing",
] as const;

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

/**
 * Chrome 的 getComputedStyle／canvas.fillStyle 讀回可能仍是 lab()。
 * 一律用實際像素讀出 rgb，避免舊 html2canvas 解析失敗。
 */
export function cssColorToRgb(cssColor: string): string {
  const v = String(cssColor ?? "").trim();
  if (!v || v === "none" || v === "transparent" || v === "currentcolor") return v;
  if (!MODERN_COLOR_FN_RE.test(v)) return v;

  const ctx = getMeasureCtx();
  if (!ctx) return "rgb(0, 0, 0)";
  try {
    ctx.clearRect(0, 0, 1, 1);
    // 先塗白再塗目標色，方便半透明色合成
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 1, 1);
    ctx.fillStyle = "#000000";
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    const r = d[0] ?? 0;
    const g = d[1] ?? 0;
    const b = d[2] ?? 0;
    const a = (d[3] ?? 255) / 255;
    if (a >= 0.999) return `rgb(${r}, ${g}, ${b})`;
    return `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(4))})`;
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
  // 保險：若仍殘留現代色碼，整段改黑，避免 html2canvas 爆炸
  if (MODERN_COLOR_FN_RE.test(result)) return "rgb(0, 0, 0)";
  return result;
}

export function sanitizeCssValue(prop: string, value: string): string {
  if (!value) return value;
  if (!MODERN_COLOR_FN_RE.test(value)) return value;
  if (
    prop === "color" ||
    prop.endsWith("-color") ||
    prop === "background-color" ||
    prop === "border-color" ||
    prop === "outline-color" ||
    prop === "text-decoration-color" ||
    prop === "caret-color" ||
    prop === "fill" ||
    prop === "stroke"
  ) {
    const rgb = cssColorToRgb(value);
    return MODERN_COLOR_FN_RE.test(rgb) ? "rgb(0, 0, 0)" : rgb;
  }
  return replaceModernColorsInCssValue(value);
}

export function applySafeInlineStyles(source: HTMLElement, target: HTMLElement): void {
  const computed = window.getComputedStyle(source);
  for (const prop of INLINE_STYLE_PROPS) {
    const raw = computed.getPropertyValue(prop);
    if (!raw) continue;
    try {
      target.style.setProperty(prop, sanitizeCssValue(prop, raw));
    } catch {
      /* 略過無法設定的屬性 */
    }
  }
  // 再掃一次 style cssText，清掉殘留 lab
  if (MODERN_COLOR_FN_RE.test(target.style.cssText)) {
    target.style.cssText = replaceModernColorsInCssValue(target.style.cssText);
  }
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("讀取圖片失敗"));
    reader.readAsDataURL(blob);
  });
}

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
        /* 缺圖仍可產 PDF */
      }
    })
  );
  return () => {
    for (const { img, src } of backups) img.src = src;
  };
}

export async function loadHtml2CanvasPro(): Promise<typeof import("html2canvas-pro").default> {
  const mod = await import("html2canvas-pro");
  const fn = (mod as { default?: unknown }).default ?? mod;
  if (typeof fn !== "function") {
    throw new Error("html2canvas-pro 載入失敗");
  }
  return fn as typeof import("html2canvas-pro").default;
}

/**
 * 在空白 iframe 中截圖：無 Tailwind stylesheet，只靠已轉成 rgb 的 inline style。
 */
export async function captureElementInIsolatedFrame(
  source: HTMLElement,
  opts: { widthPx: number; heightPx: number; scale?: number; backgroundColor?: string }
): Promise<HTMLCanvasElement> {
  const html2canvas = await loadHtml2CanvasPro();
  const restoreImages = await inlineImagesAsDataUrls(source);

  const clone = source.cloneNode(true) as HTMLElement;
  const srcNodes = [source, ...Array.from(source.querySelectorAll<HTMLElement>("*"))];
  const dstNodes = [clone, ...Array.from(clone.querySelectorAll<HTMLElement>("*"))];

  for (let i = 0; i < srcNodes.length; i++) {
    const src = srcNodes[i];
    const dst = dstNodes[i];
    if (!src || !dst) continue;
    dst.removeAttribute("class");
    dst.removeAttribute("data-pdf-export-id");
    applySafeInlineStyles(src, dst);
  }

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = [
    "position:fixed",
    "left:-12000px",
    "top:0",
    `width:${opts.widthPx}px`,
    `height:${opts.heightPx}px`,
    "border:0",
    "opacity:0",
    "pointer-events:none",
    "background:#fff",
  ].join(";");
  document.body.appendChild(iframe);

  try {
    const doc = iframe.contentDocument;
    if (!doc) throw new Error("無法建立匯出用 iframe");
    doc.open();
    doc.write(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        html,body{margin:0;padding:0;background:#fff;}
        *{box-sizing:border-box;}
        img{max-width:100%;}
      </style></head><body></body></html>`
    );
    doc.close();

    const imported = doc.importNode(clone, true) as HTMLElement;
    doc.body.appendChild(imported);
    // 等字型／圖片穩一下
    await new Promise((r) => window.setTimeout(r, 30));

    const canvas = await html2canvas(imported, {
      scale: opts.scale ?? 2,
      useCORS: true,
      allowTaint: false,
      logging: false,
      backgroundColor: opts.backgroundColor ?? "#ffffff",
      width: opts.widthPx,
      height: opts.heightPx,
      windowWidth: opts.widthPx,
      windowHeight: opts.heightPx,
      foreignObjectRendering: false,
    });
    return canvas;
  } finally {
    iframe.remove();
    restoreImages();
  }
}

/** 舊路徑相容：整份節點準備（型錄 html2pdf 仍可能用到） */
export async function prepareDomForHtml2Canvas(
  root: HTMLElement,
  opts?: { hideSelectors?: string[]; captureWidthPx?: number }
): Promise<() => void> {
  const hideSelectors = opts?.hideSelectors ?? [".no-print"];
  const hidden: { el: HTMLElement; display: string }[] = [];
  for (const sel of hideSelectors) {
    for (const node of Array.from(root.querySelectorAll<HTMLElement>(sel))) {
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
  const styleBackup: { el: HTMLElement; style: string | null }[] = [];
  const nodes = [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))];
  for (const el of nodes) {
    styleBackup.push({ el, style: el.getAttribute("style") });
    applySafeInlineStyles(el, el);
    el.removeAttribute("class");
  }

  const removedSheets: { node: Element; parent: Node; next: ChildNode | null }[] = [];
  for (const node of Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))) {
    if (!node.parentNode) continue;
    removedSheets.push({ node, parent: node.parentNode, next: node.nextSibling });
    node.parentNode.removeChild(node);
  }

  return () => {
    for (const { node, parent, next } of removedSheets.reverse()) {
      parent.insertBefore(node, next);
    }
    for (const { el, style } of styleBackup) {
      if (style == null) el.removeAttribute("style");
      else el.setAttribute("style", style);
    }
    if (opts?.captureWidthPx != null) {
      root.style.width = prevWidth;
      root.style.maxWidth = prevMaxWidth;
    }
    for (const { el, display } of hidden) el.style.display = display;
    restoreImages();
  };
}

export type SafeHtml2PdfOptions = {
  root: HTMLElement;
  filename: string;
  margin?: number | number[];
  backgroundColor?: string;
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

/** 型錄等：改為 html2canvas-pro + jsPDF，不再走會夾帶舊 html2canvas 的 html2pdf */
export async function exportElementToPdfSafe(opts: SafeHtml2PdfOptions): Promise<void> {
  const {
    root,
    filename,
    margin = [0, 0, 0, 0],
    backgroundColor = "#ffffff",
    captureWidthPx = 794,
    imageQuality = 0.95,
  } = opts;

  const { jsPDF } = await import("jspdf");
  const marginArr = Array.isArray(margin) ? margin : [margin, margin, margin, margin];
  const [mTop, mRight, mBottom, mLeft] = [
    Number(marginArr[0] ?? 0),
    Number(marginArr[1] ?? marginArr[0] ?? 0),
    Number(marginArr[2] ?? marginArr[0] ?? 0),
    Number(marginArr[3] ?? marginArr[1] ?? marginArr[0] ?? 0),
  ];

  const prevWidth = root.style.width;
  const prevMaxWidth = root.style.maxWidth;
  root.style.width = `${captureWidthPx}px`;
  root.style.maxWidth = `${captureWidthPx}px`;

  try {
    const canvas = await captureElementInIsolatedFrame(root, {
      widthPx: captureWidthPx,
      heightPx: Math.max(root.scrollHeight, root.offsetHeight, 1),
      scale: 2,
      backgroundColor,
    });

    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const pageWidth = 210 - mLeft - mRight;
    const pageHeight = 297 - mTop - mBottom;
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    let heightLeft = imgHeight;
    let position = mTop;
    const img = canvas.toDataURL("image/jpeg", imageQuality);

    pdf.addImage(img, "JPEG", mLeft, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;

    while (heightLeft > 1) {
      position = mTop - (imgHeight - heightLeft);
      pdf.addPage();
      pdf.addImage(img, "JPEG", mLeft, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }

    pdf.save(filename);
  } finally {
    root.style.width = prevWidth;
    root.style.maxWidth = prevMaxWidth;
  }
}
