"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type SignaturePadProps = {
  value: string;
  onChange: (dataUrl: string) => void;
  disabled?: boolean;
  className?: string;
};

/** 指標位置轉為 canvas 內 CSS 像素座標（與 setTransform(dpr) 後的繪圖座標系一致） */
function pointerToLocal(canvas: HTMLCanvasElement, e: PointerEvent) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  };
}

function configureContext(ctx: CanvasRenderingContext2D) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#1c1917";
}

export function SignaturePad({ value, onChange, disabled, className }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drawingRef = useRef(false);
  const valueRef = useRef(value);
  const [hasStroke, setHasStroke] = useState(Boolean(value));

  useEffect(() => {
    valueRef.current = value;
    setHasStroke(Boolean(value));
  }, [value]);

  const fitCanvas = useCallback((restoreFromValue = true) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    configureContext(ctx);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const src = restoreFromValue ? valueRef.current : "";
    if (src) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, rect.width, rect.height);
      };
      img.src = src;
    }
  }, []);

  useEffect(() => {
    fitCanvas(true);
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => fitCanvas(true));
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [fitCanvas]);

  const exportImage = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onChange(canvas.toDataURL("image/png"));
  }, [onChange]);

  const clear = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || disabled) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    setHasStroke(false);
    onChange("");
    valueRef.current = "";
  }, [disabled, onChange]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawingRef.current = true;
    canvas.setPointerCapture(e.pointerId);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { x, y } = pointerToLocal(canvas, e.nativeEvent);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || disabled) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { x, y } = pointerToLocal(canvas, e.nativeEvent);
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasStroke(true);
  };

  const endStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const canvas = canvasRef.current;
    if (canvas?.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    exportImage();
  };

  return (
    <div className={className}>
      <p className="mb-1 text-xs font-medium text-stone-600">電子簽名（請在此簽名，每筆請款各簽一次）</p>
      <div
        ref={wrapRef}
        className="relative rounded-lg border-2 border-dashed border-stone-300 bg-white"
      >
        <canvas
          ref={canvasRef}
          className="block h-28 w-full touch-none cursor-crosshair rounded-lg"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endStroke}
          onPointerLeave={endStroke}
          aria-label="電子簽名板"
        />
        {!hasStroke && !value ? (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-stone-400">
            用手指或滑鼠在此簽名
          </p>
        ) : null}
      </div>
      <button
        type="button"
        disabled={disabled || (!hasStroke && !value)}
        onClick={clear}
        className="mt-2 text-xs font-semibold text-stone-500 hover:text-stone-800 disabled:opacity-40"
      >
        清除簽名
      </button>
    </div>
  );
}
