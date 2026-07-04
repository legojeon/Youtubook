export const MAX_VIDEO_DURATION_SEC = 2 * 60 * 60;
export const MAX_SCAN_SAMPLES = 3600;
export const MAX_CAPTION_EVENTS = 100_000;
export const MAX_TIMEDTEXT_URLS_PER_VIDEO = 8;
export const THUMB_CHUNK_SIZE = 100;

export function validateVideoDuration(durationSec: number): boolean {
  return (
    Number.isFinite(durationSec) &&
    durationSec > 0 &&
    durationSec <= MAX_VIDEO_DURATION_SEC
  );
}

export function scanIntervalForDuration(durationSec: number): number {
  return Math.max(1, durationSec / MAX_SCAN_SAMPLES);
}
