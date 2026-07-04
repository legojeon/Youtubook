import { describe, expect, it } from 'vitest';
import {
  MAX_SCAN_SAMPLES,
  MAX_VIDEO_DURATION_SEC,
  scanIntervalForDuration,
  validateVideoDuration,
} from './limits';

describe('scanIntervalForDuration', () => {
  it('uses one-second samples for a one-hour video', () => {
    expect(scanIntervalForDuration(3600)).toBe(1);
  });

  it('bounds a maximum-duration video to the sample limit', () => {
    const interval = scanIntervalForDuration(MAX_VIDEO_DURATION_SEC);

    expect(interval).toBe(2);
    expect(Math.ceil(MAX_VIDEO_DURATION_SEC / interval)).toBeLessThanOrEqual(
      MAX_SCAN_SAMPLES,
    );
  });
});

describe('validateVideoDuration', () => {
  it('accepts the maximum duration and rejects a duration above it', () => {
    expect(validateVideoDuration(7200)).toBe(true);
    expect(validateVideoDuration(7200.01)).toBe(false);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects a non-positive or non-finite duration (%s)',
    (durationSec) => {
      expect(validateVideoDuration(durationSec)).toBe(false);
    },
  );
});
