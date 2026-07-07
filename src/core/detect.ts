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

// Adaptive detection (reimplements PySceneDetect AdaptiveDetector; BSD-3-Clause):
// a cut is a sample whose score is a large multiple of the local neighbourhood
// average AND above a minimum absolute value. This suppresses false cuts during
// sustained motion (the local average rises with it) while still catching real
// spikes — including from a near-zero baseline (static storybook scenes).
// Local-baseline half-window, expressed in TIME. It is converted to a sample
// count per call (round(WINDOW_SECONDS / sampleIntervalSec)) so the baseline always
// spans ~2s of video regardless of scan density. Fixing this in samples would let a
// denser scan (0.25s) silently shrink the window to ~0.5s, destabilising the local
// average and mis-tuning the sensitivity thresholds (calibrated for a ~2s baseline).
const WINDOW_SECONDS = 2;
const EPS = 1e-5;
const MAX_RATIO = 255;

/** Map the 1~10 sensitivity slider to adaptive parameters. Higher sensitivity →
 *  lower ratio threshold + lower minimum score = more cuts. First-pass values;
 *  re-calibrate on real videos. */
export function sensitivityToParams(
  sensitivity: number,
): { ratioThreshold: number; minContentVal: number } {
  const s = Math.min(10, Math.max(1, sensitivity));
  const ratioThreshold = 5.0 - (s - 1) * (3.5 / 9); // s1 = 5.0 → s10 = 1.5
  const minContentVal = 18 - (s - 1) * (12 / 9);     // s1 = 18  → s10 = 6
  return { ratioThreshold, minContentVal };
}

export function detectScenes(scores: number[], opts: DetectOptions): DetectResult {
  const { ratioThreshold, minContentVal } = sensitivityToParams(opts.sensitivity);
  const minGap = Math.max(1, Math.round(opts.minSceneSec / opts.sampleIntervalSec));
  // Baseline half-window in samples, held at ~WINDOW_SECONDS of time across densities.
  const windowWidth = Math.max(1, Math.round(WINDOW_SECONDS / (opts.sampleIntervalSec || 1)));
  const n = scores.length;

  const cuts: { index: number; strength: number }[] = [];
  let lastCut = 0;
  for (let i = 1; i < n; i++) {
    if (i - lastCut < minGap) continue;

    // Local baseline: average of the neighbouring samples (excluding i itself).
    let sum = 0;
    let cnt = 0;
    for (let j = Math.max(1, i - windowWidth); j <= Math.min(n - 1, i + windowWidth); j++) {
      if (j === i) continue;
      sum += scores[j];
      cnt++;
    }
    const avg = cnt > 0 ? sum / cnt : 0;
    const ratio = avg > EPS
      ? Math.min(scores[i] / avg, MAX_RATIO)
      : (scores[i] >= minContentVal ? MAX_RATIO : 0);

    if (ratio >= ratioThreshold && scores[i] >= minContentVal) {
      cuts.push({ index: i, strength: ratio });
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
