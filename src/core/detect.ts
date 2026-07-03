import type { SceneRange } from './types';

export interface DetectOptions {
  sensitivity: number;       // 1~10, 클수록 장면을 잘게 나눔
  sampleIntervalSec: number;
  minSceneSec: number;
  maxScenes: number;
  durationSec: number;
}

export interface DetectResult {
  ranges: SceneRange[];
  truncated: boolean;
}

export const DEFAULT_DETECT = {
  sensitivity: 5,
  sampleIntervalSec: 1,
  minSceneSec: 2,
  maxScenes: 300,
} as const;

const FADE_WINDOW = 3;   // 누적 판정 창(샘플 수)
const FADE_FACTOR = 1.8; // 창 합이 threshold*1.8 이상이면 페이드 경계

export function sensitivityToThreshold(sensitivity: number): number {
  const s = Math.min(10, Math.max(1, sensitivity));
  return 8 + (10 - s) * 6;
}

export function detectScenes(scores: number[], opts: DetectOptions): DetectResult {
  const threshold = sensitivityToThreshold(opts.sensitivity);
  const minGap = Math.max(1, Math.round(opts.minSceneSec / opts.sampleIntervalSec));

  // 최소 장면 길이 때문에 건너뛴 샘플은 전환에 소비된 것으로 보고 0 처리 —
  // 그대로 두면 직후 페이드 누적 창에 흘러들어 이중 분할된다.
  const work = [...scores];
  const cuts: { index: number; strength: number }[] = [];
  let lastCut = 0;
  for (let i = 1; i < work.length; i++) {
    if (i - lastCut < minGap) {
      work[i] = 0;
      continue;
    }
    const winStart = Math.max(lastCut + 1, i - FADE_WINDOW + 1);
    let winSum = 0;
    for (let j = winStart; j <= i; j++) winSum += work[j];
    if (work[i] >= threshold || winSum >= threshold * FADE_FACTOR) {
      cuts.push({ index: i, strength: Math.max(work[i], winSum / FADE_WINDOW) });
      lastCut = i;
    }
  }

  let kept = cuts;
  const truncated = cuts.length + 1 > opts.maxScenes;
  if (truncated) {
    kept = [...cuts]
      .sort((a, b) => b.strength - a.strength)
      .slice(0, opts.maxScenes - 1)
      .sort((a, b) => a.index - b.index);
  }

  const bounds = [0, ...kept.map(c => c.index * opts.sampleIntervalSec), opts.durationSec];
  const ranges: SceneRange[] = [];
  for (let k = 0; k + 1 < bounds.length; k++) {
    const startSec = bounds[k];
    const endSec = bounds[k + 1];
    if (endSec - startSec <= 0) continue;
    ranges.push({ startSec, endSec, repSec: startSec + (endSec - startSec) / 2 });
  }
  return { ranges, truncated };
}
