export const MAX_VIDEO_DURATION_SEC = 2 * 60 * 60;
export const MAX_SCAN_SAMPLES = 3600;
export const MAX_CAPTION_EVENTS = 100_000;
export const MAX_CUE_TEXT_CHARS = 10_000;
export const MAX_TOTAL_CUE_TEXT_CHARS = 1_000_000;
export const MAX_TIMEDTEXT_URLS_PER_VIDEO = 8;
export const MAX_TIMEDTEXT_URLS_TOTAL = 64;
export const MAX_PENDING_TIMEDTEXT_WAITERS = 32;
export const THUMB_CHUNK_SIZE = 100;

export function validateScanScores(scores: unknown): asserts scores is number[] {
  if (!Array.isArray(scores)
    || scores.length < 1
    || scores.length > MAX_SCAN_SAMPLES) {
    throw new Error(`Scan scores must contain between 1 and ${MAX_SCAN_SAMPLES} entries.`);
  }
  for (const score of scores) {
    if (typeof score !== 'number' || !Number.isFinite(score)) {
      throw new Error('Scan scores must contain only finite numbers.');
    }
  }
}

export function validateVideoDuration(durationSec: number): boolean {
  return (
    Number.isFinite(durationSec) &&
    durationSec > 0 &&
    durationSec <= MAX_VIDEO_DURATION_SEC
  );
}

export function scanIntervalForDuration(durationSec: number): number {
  return Math.max(0.5, durationSec / MAX_SCAN_SAMPLES);
}
