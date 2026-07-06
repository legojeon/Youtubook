// Book export re-encodes scene/cover images to WebP. The default keeps full
// resolution (WebP is ~30% smaller than the captured JPEG with no visible loss);
// the optional downscale trades resolution for a much smaller single-file HTML.
export const BOOK_IMAGE_TYPE = 'image/webp';
export const BOOK_FULL_QUALITY = 0.85;
export const BOOK_SMALL_MAX_EDGE = 1280;
export const BOOK_SMALL_QUALITY = 0.8;
// PDF/PPTX embed JPEG (jsPDF/PowerPoint don't reliably take WebP), so the slide
// downscale re-encodes to JPEG at the same size cap.
export const SLIDE_IMAGE_TYPE = 'image/jpeg';

/** Re-encode parameters for the book: full-resolution WebP unless downscaling. */
export function bookImageParams(
  downscale: boolean,
): { maxEdge: number; type: string; quality: number } {
  return downscale
    ? { maxEdge: BOOK_SMALL_MAX_EDGE, type: BOOK_IMAGE_TYPE, quality: BOOK_SMALL_QUALITY }
    : { maxEdge: Infinity, type: BOOK_IMAGE_TYPE, quality: BOOK_FULL_QUALITY };
}

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

/**
 * Re-encode a captured frame for the HTML book. Full-resolution WebP by
 * default; `downscale` caps the longest edge at 1280px for a smaller file.
 */
export function resizeForBook(dataUrl: string, downscale: boolean): Promise<string> {
  const { maxEdge, type, quality } = bookImageParams(downscale);
  return reencodeImage(dataUrl, maxEdge, type, quality);
}

/**
 * PDF/PPTX frame. When not downscaling, the captured full-resolution JPEG is
 * kept as-is (no re-encode). When downscaling, it is re-encoded to JPEG capped
 * at 1280px — those formats can't take WebP, so there is no full-res win here.
 */
export function resizeForSlides(dataUrl: string, downscale: boolean): Promise<string> {
  if (!downscale) return Promise.resolve(dataUrl);
  return reencodeImage(dataUrl, BOOK_SMALL_MAX_EDGE, SLIDE_IMAGE_TYPE, BOOK_SMALL_QUALITY);
}
