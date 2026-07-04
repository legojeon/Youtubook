import { describe, expect, it } from 'vitest';
import { applyThumbChunk, splitThumbs, thumbsComplete } from './thumb-chunks';

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

  it('rejects overlapping chunks', () => {
    const target: string[] = [];
    applyThumbChunk(target, 0, ['thumb-0', 'thumb-1']);

    expect(() => applyThumbChunk(target, 1, ['replacement'])).toThrow();
  });

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid start index %s',
    startIndex => {
      expect(() => applyThumbChunk([], startIndex, ['thumb'])).toThrow();
    },
  );
});

describe('thumbsComplete', () => {
  it('rejects empty and non-string entries', () => {
    expect(thumbsComplete(['thumb', ''], 2)).toBe(false);
    expect(thumbsComplete(['thumb', 1 as unknown as string], 2)).toBe(false);
  });
});
