export const IMAGE_UPLOAD_MAX_EDGE = 1920;
export const IMAGE_UPLOAD_QUALITY = 0.82;

type ImageSize = { width: number; height: number };

export function fitImageInside(width: number, height: number, maxEdge = IMAGE_UPLOAD_MAX_EDGE): ImageSize {
  if (width <= maxEdge && height <= maxEdge) return { width, height };
  const scale = maxEdge / Math.max(width, height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function compressedImageName(name: string, mimeType = "image/webp"): string {
  const base = name.replace(/\.[^.]+$/, "") || "photo";
  if (mimeType === "image/png") return `${base}.png`;
  if (mimeType === "image/jpeg") return `${base}.jpg`;
  return `${base}.webp`;
}

type DecodedImage = ImageSize & { source: CanvasImageSource; close: () => void };

async function decodeImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  }

  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  try {
    await image.decode();
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function encodeCanvas(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function compressImageForUpload(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif" || file.type === "image/svg+xml") return file;

  let decoded: DecodedImage | null = null;
  try {
    decoded = await decodeImage(file);
    const target = fitImageInside(decoded.width, decoded.height);
    const resized = target.width !== decoded.width || target.height !== decoded.height;
    if (!resized && file.size <= 350 * 1024) return file;

    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(decoded.source, 0, 0, target.width, target.height);

    let blob = await encodeCanvas(canvas, "image/webp", IMAGE_UPLOAD_QUALITY);
    let outputType = "image/webp";
    if (!blob) {
      outputType = file.type === "image/png" ? "image/png" : "image/jpeg";
      blob = await encodeCanvas(canvas, outputType, outputType === "image/jpeg" ? IMAGE_UPLOAD_QUALITY : undefined);
    }
    if (!blob || (!resized && blob.size >= file.size)) return file;

    return new File([blob], compressedImageName(file.name, outputType), {
      type: outputType,
      lastModified: file.lastModified,
    });
  } catch {
    // Some Android browsers cannot decode HEIC/HEIF. Keep the original so uploads still work.
    return file;
  } finally {
    decoded?.close();
  }
}
