import type { Msg } from '../messages';

export interface ProgressReporter {
  report(percent: number, stage: string, force?: boolean): void;
}

/**
 * Sends EXTRACTION_PROGRESS to the SW, throttled to at most once per
 * `minIntervalMs` unless `force` (stage changes force an immediate send).
 */
export function createProgressReporter(
  send: (message: Msg) => void,
  now: () => number = () => Date.now(),
  minIntervalMs = 1000,
): ProgressReporter {
  let last = -Infinity;
  return {
    report(percent, stage, force = false) {
      const t = now();
      if (!force && t - last < minIntervalMs) return;
      last = t;
      send({
        type: 'EXTRACTION_PROGRESS',
        percent: Math.max(0, Math.min(100, Math.round(percent))),
        stage,
      });
    },
  };
}
