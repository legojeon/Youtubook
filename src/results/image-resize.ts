// Book export re-encodes scene/cover images smaller than the captured
// full-resolution frames to keep the single-file HTML from ballooning.
export const BOOK_IMAGE_MAX_EDGE = 1280;
export const BOOK_IMAGE_TYPE = 'image/webp';
export const BOOK_IMAGE_QUALITY = 0.8;

/** Downscale (never upscale) so the longest edge fits `maxEdge`, keeping aspect. */
export function fitDimensions(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 0, height: 0 };
  }
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width: Math.round(width), height: Math.round(height) };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('이미지를 불러오지 못했습니다.'));
    img.src = src;
  });
}

/**
 * Re-encode a data-URL image downscaled to `maxEdge` in `type` at `quality`.
 * Returns the original data URL unchanged if anything goes wrong, so a resize
 * failure never blocks the export.
 */
export async function reencodeImage(
  dataUrl: string,
  maxEdge: number,
  type: string,
  quality: number,
): Promise<string> {
  try {
    const img = await loadImage(dataUrl);
    const { width, height } = fitDimensions(img.naturalWidth, img.naturalHeight, maxEdge);
    if (!width || !height) return dataUrl;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, width, height);
    const out = canvas.toDataURL(type, quality);
    // A browser without WebP encoding silently yields a larger PNG; still valid.
    return out.startsWith('data:image/') ? out : dataUrl;
  } catch {
    return dataUrl;
  }
}

/** Re-encode a captured frame for the HTML book (≤1280px, WebP q0.8). */
export function resizeForBook(dataUrl: string): Promise<string> {
  return reencodeImage(dataUrl, BOOK_IMAGE_MAX_EDGE, BOOK_IMAGE_TYPE, BOOK_IMAGE_QUALITY);
}
