import { describe, expect, it } from 'vitest';
import {
  applyThumbChunk,
  MAX_SESSION_THUMB_CHARS,
  MAX_THUMB_DATA_URL_LENGTH,
  splitThumbs,
  thumbsComplete,
  validateThumbChunk,
} from './thumb-chunks';
import { MAX_SCAN_SAMPLES, THUMB_CHUNK_SIZE } from './limits';

describe('splitThumbs', () => {
  it('splits 205 thumbnails into chunks of at most 100', () => {
    const thumbs = Array.from({ length: 205 }, (_, i) => `thumb-${i}`);

    expect(splitThumbs(thumbs, 100).map(chunk => [chunk.startIndex, chunk.thumbs.length]))
      .toEqual([[0, 100], [100, 100], [200, 5]]);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid chunk size %s',
    size => {
      expect(() => splitThumbs(['thumb'], size)).toThrow();
    },
  );
});

describe('applyThumbChunk', () => {
  it('applies sequential chunks and reports completeness for the exact expected length', () => {
    const target: string[] = [];

    applyThumbChunk(target, 0, ['thumb-0', 'thumb-1']);
    applyThumbChunk(target, 2, ['thumb-2']);

    expect(target).toEqual(['thumb-0', 'thumb-1', 'thumb-2']);
    expect(thumbsComplete(target, 3)).toBe(true);
    expect(thumbsComplete(target, 4)).toBe(false);
  });

  it('reports sparse arrays with a gap as incomplete', () => {
    const target: string[] = [];

    applyThumbChunk(target, 1, ['thumb-1']);

    expect(target.length).toBe(2);
    expect(thumbsComplete(target, 2)).toBe(false);
  });

  it('accepts reordered non-overlapping chunks', () => {
    const target: string[] = [];

    applyThumbChunk(target, 2, ['thumb-2', 'thumb-3']);
    applyThumbChunk(target, 0, ['thumb-0', 'thumb-1']);

    expect(target).toEqual(['thumb-0', 'thumb-1', 'thumb-2', 'thumb-3']);
    expect(thumbsComplete(target, 4)).toBe(true);
  });

  it('accepts an exact duplicate retransmission', () => {
    const target = ['thumb-0', 'thumb-1'];

    const exactBudget = target.reduce((total, thumb) => total + thumb.length, 0);
    expect(() => applyThumbChunk(target, 0, ['thumb-0', 'thumb-1'], exactBudget))
      .not.toThrow();
    expect(target).toEqual(['thumb-0', 'thumb-1']);
  });

  it('rejects a later conflicting overlap without filling earlier holes', () => {
    const target: string[] = [];
    target[3] = 'existing';

    expect(() => applyThumbChunk(target, 1, ['new-1', 'new-2', 'conflict']))
      .toThrow();
    expect(Object.hasOwn(target, 1)).toBe(false);
    expect(Object.hasOwn(target, 2)).toBe(false);
    expect(target[3]).toBe('existing');
  });

  it('accepts the aggregate budget boundary and rejects excess without mutation', () => {
    const target = ['abc'];

    applyThumbChunk(target, 1, ['de'], 5);
    const before = [...target];
    expect(() => applyThumbChunk(target, 2, ['f'], 5)).toThrow();
    expect(target).toEqual(before);
  });

  it('budgets at least 32 KiB for each maximum-length scan thumbnail', () => {
    expect(MAX_SESSION_THUMB_CHARS)
      .toBeGreaterThanOrEqual(MAX_SCAN_SAMPLES * 32 * 1024);
  });

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid start index %s',
    startIndex => {
      expect(() => applyThumbChunk([], startIndex, ['thumb'])).toThrow();
    },
  );
});

describe('validateThumbChunk', () => {
  const thumbs = (length: number) => Array.from({ length }, (_, i) => `thumb-${i}`);

  it('accepts 100 thumbnails and rejects 101', () => {
    expect(() => validateThumbChunk(0, thumbs(THUMB_CHUNK_SIZE), 200)).not.toThrow();
    expect(() => validateThumbChunk(0, thumbs(THUMB_CHUNK_SIZE + 1), 200)).toThrow();
  });

  it('rejects a non-array payload and an empty chunk', () => {
    expect(() => validateThumbChunk(0, 'not-an-array', 1)).toThrow();
    expect(() => validateThumbChunk(0, [], 1)).toThrow();
  });

  it('rejects an unsafe start index', () => {
    expect(() => validateThumbChunk(Number.MAX_SAFE_INTEGER + 1, ['thumb'], 1)).toThrow();
  });

  it('rejects a chunk outside the expected score range', () => {
    expect(() => validateThumbChunk(2, ['thumb-2', 'thumb-3'], 3)).toThrow();
  });

  it('rejects empty, non-string, and oversized thumbnails', () => {
    expect(() => validateThumbChunk(0, [''], 1)).toThrow();
    expect(() => validateThumbChunk(0, [123], 1)).toThrow();
    expect(() => validateThumbChunk(0, ['x'.repeat(MAX_THUMB_DATA_URL_LENGTH + 1)], 1))
      .toThrow();
  });
});

describe('thumbsComplete', () => {
  it('rejects empty and non-string entries', () => {
    expect(thumbsComplete(['thumb', ''], 2)).toBe(false);
    expect(thumbsComplete(['thumb', 1 as unknown as string], 2)).toBe(false);
  });
});
