import { describe, expect, it } from 'vitest';
import { captionPresentationForMeta } from './caption-presentation';

describe('captionPresentationForMeta', () => {
  it('enables TXT without a warning only for available captions', () => {
    expect(captionPresentationForMeta({
      captionsAvailable: true,
      captionStatus: 'available',
    })).toEqual({ txtEnabled: true, warningKey: null });
  });

  it('shows the persistent no-caption warning for absent captions', () => {
    expect(captionPresentationForMeta({
      captionsAvailable: false,
      captionStatus: 'absent',
    })).toEqual({ txtEnabled: false, warningKey: 'banner_noCaptions' });
  });

  it('shows a retry warning for caption fetch failures', () => {
    expect(captionPresentationForMeta({
      captionsAvailable: false,
      captionStatus: 'fetch-failed',
    })).toEqual({ txtEnabled: false, warningKey: 'banner_captionFetchFail' });
  });

  it('normalizes legacy metadata from captionsAvailable', () => {
    expect(captionPresentationForMeta({ captionsAvailable: true }).txtEnabled).toBe(true);
    expect(captionPresentationForMeta({ captionsAvailable: false }).warningKey)
      .toBe('banner_noCaptions');
  });
});
