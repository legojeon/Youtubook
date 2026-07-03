export interface FrameData {
  data: Uint8ClampedArray | number[];
  width: number;
  height: number;
}

/** 두 프레임의 RGB 평균 절대차 (0~255). ImageData와 구조 호환. */
export function frameDiffScore(a: FrameData, b: FrameData): number {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`frame size mismatch: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
  const n = a.width * a.height;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    sum +=
      Math.abs((a.data[p] ?? 0) - (b.data[p] ?? 0)) +
      Math.abs((a.data[p + 1] ?? 0) - (b.data[p + 1] ?? 0)) +
      Math.abs((a.data[p + 2] ?? 0) - (b.data[p + 2] ?? 0));
  }
  return sum / (n * 3);
}
