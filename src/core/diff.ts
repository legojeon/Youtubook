export interface FrameData {
  data: Uint8ClampedArray | number[];
  width: number;
  height: number;
}

/**
 * RGB (0~255) → HSV in OpenCV's 8-bit scale (H 0~179, S 0~255, V 0~255).
 * Used by frameContentScore. Reimplements the color conversion PySceneDetect's
 * ContentDetector relies on (cv2.cvtColor BGR2HSV).
 */
export function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const v = max;
  const s = max === 0 ? 0 : Math.round((d * 255) / max);
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
    if (h < 0) h += 360;
  }
  return { h: Math.round(h / 2) % 180, s, v };
}

/**
 * Mean of the per-channel (H, S, V) mean-absolute pixel difference between two
 * frames (0~255 scale). Reimplements PySceneDetect ContentDetector's default
 * content_val (equal 1:1:1 weights; BSD-3-Clause, algorithm reimplemented).
 * Working in HSV makes brightness-only changes affect only V, so they no longer
 * dominate the score the way they do in RGB. ImageData-compatible.
 */
export function frameContentScore(a: FrameData, b: FrameData): number {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`frame size mismatch: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
  const n = a.width * a.height;
  if (n === 0) return 0;
  let sh = 0;
  let ss = 0;
  let sv = 0;
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const ca = rgbToHsv(a.data[p] ?? 0, a.data[p + 1] ?? 0, a.data[p + 2] ?? 0);
    const cb = rgbToHsv(b.data[p] ?? 0, b.data[p + 1] ?? 0, b.data[p + 2] ?? 0);
    sh += Math.abs(ca.h - cb.h);
    ss += Math.abs(ca.s - cb.s);
    sv += Math.abs(ca.v - cb.v);
  }
  return (sh / n + ss / n + sv / n) / 3;
}
