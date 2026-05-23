/** 將圖片中心裁切為正方形並縮放（供 KOL 形象照上傳） */
export async function cropImageFileToSquareJpeg(file: File, maxSize = 800): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const size = Math.min(bitmap.width, bitmap.height);
    const sx = Math.floor((bitmap.width - size) / 2);
    const sy = Math.floor((bitmap.height - size) / 2);
    const outSize = Math.min(maxSize, size);
    const canvas = document.createElement("canvas");
    canvas.width = outSize;
    canvas.height = outSize;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("無法處理圖片");
    ctx.drawImage(bitmap, sx, sy, size, size, 0, 0, outSize, outSize);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("圖片轉檔失敗"))),
        "image/jpeg",
        0.9
      );
    });
    return blob;
  } finally {
    bitmap.close();
  }
}
