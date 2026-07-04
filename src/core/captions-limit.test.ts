import { describe, expect, it } from 'vitest';
import { captionStatusForMeta, parseJson3 } from './captions';

describe('parseJson3 limits', () => {
  it('rejects more than 100,000 caption events before parsing them', () => {
    const events = Array.from({ length: 100_001 }, () => null);

    expect(() => parseJson3({ events })).toThrowError('too-many-events');
  });
});

describe('captionStatusForMeta', () => {
  it('uses an explicit caption status when present', () => {
    expect(captionStatusForMeta({
      captionStatus: 'fetch-failed',
      captionsAvailable: false,
    })).toBe('fetch-failed');
  });

  it('normalizes legacy caption availability when status is absent', () => {
    expect(captionStatusForMeta({ captionsAvailable: true })).toBe('available');
    expect(captionStatusForMeta({ captionsAvailable: false })).toBe('absent');
  });
});
