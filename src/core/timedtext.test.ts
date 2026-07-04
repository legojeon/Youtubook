import { describe, expect, it } from 'vitest';
import { TimedtextUrlCache, toJson3TimedtextUrl } from './timedtext';

const url = (v: string, lang: string, kind = '', pot = 'proof') =>
  `https://www.youtube.com/api/timedtext?v=${v}&lang=${lang}${kind ? `&kind=${kind}` : ''}&pot=${pot}`;

describe('TimedtextUrlCache', () => {
  it('rejects non-YouTube, wrong-path, and tokenless URLs', () => {
    const cache = new TimedtextUrlCache(8);

    expect(cache.add('https://evil.example/api/timedtext?v=v1&pot=x', 1)).toBe(false);
    expect(cache.add('https://www.youtube.com/watch?v=v1&pot=x', 2)).toBe(false);
    expect(cache.add('https://www.youtube.com/api/timedtext?v=v1', 3)).toBe(false);
  });

  it('rejects missing or empty IDs and tokens, HTTP, and lookalike hosts', () => {
    const cache = new TimedtextUrlCache(8);
    const invalid = [
      'https://www.youtube.com/api/timedtext?pot=proof',
      'https://www.youtube.com/api/timedtext?v=&pot=proof',
      'https://www.youtube.com/api/timedtext?v=v1',
      'https://www.youtube.com/api/timedtext?v=v1&pot=',
      'http://www.youtube.com/api/timedtext?v=v1&pot=proof',
      'https://www.youtube.com.evil.example/api/timedtext?v=v1&pot=proof',
    ];

    for (const candidate of invalid) {
      expect(cache.add(candidate, 1), candidate).toBe(false);
    }
    expect(cache.size).toBe(0);
  });

  it('rejects credentials and duplicate ID or token parameters', () => {
    const cache = new TimedtextUrlCache(8);
    const invalid = [
      'https://user:secret@www.youtube.com/api/timedtext?v=v1&pot=proof',
      'https://www.youtube.com/api/timedtext?v=v1&v=v2&pot=proof',
      'https://www.youtube.com/api/timedtext?v=v1&pot=first&pot=second',
    ];

    for (const candidate of invalid) {
      expect(cache.add(candidate, 1), candidate).toBe(false);
    }
    expect(cache.size).toBe(0);
  });

  it('prefers matching language and ASR kind for the requested video', () => {
    const cache = new TimedtextUrlCache(8);
    cache.add(url('other-video', 'en', 'asr'), 10);
    cache.add(url('v1', 'en'), 3);
    cache.add(url('v1', 'ko', 'asr'), 4);
    cache.add(url('v1', 'en', 'asr'), 2);

    const match = cache.find({ videoId: 'v1', languageCode: 'en', kind: 'asr' });

    expect(match?.videoId).toBe('v1');
    expect(match?.languageCode).toBe('en');
    expect(match?.kind).toBe('asr');
  });

  it('prefers a no-kind entry when the query kind is omitted', () => {
    const cache = new TimedtextUrlCache(8);
    cache.add(url('v1', 'en'), 1);
    cache.add(url('v1', 'en', 'asr'), 2);

    expect(cache.find({ videoId: 'v1', languageCode: 'en' })?.kind).toBeUndefined();
  });

  it('prefers a no-language entry when the query language is omitted', () => {
    const cache = new TimedtextUrlCache(8);
    cache.add('https://www.youtube.com/api/timedtext?v=v1&pot=manual', 1);
    cache.add(url('v1', 'en', '', 'translated'), 2);

    expect(cache.find({ videoId: 'v1' })?.languageCode).toBeUndefined();
  });

  it('uses an exclusive afterStartTime cutoff and excludes stale entries', () => {
    const cache = new TimedtextUrlCache(8);
    cache.add(url('v1', 'en', 'asr', 'stale'), 4);
    cache.add(url('v1', 'en', 'asr', 'cutoff'), 5);
    cache.add(url('v1', 'en', 'asr', 'fresh'), 6);

    expect(cache.find({ videoId: 'v1', afterStartTime: 5 })?.startTime).toBe(6);
    expect(cache.find({ videoId: 'v1', afterStartTime: 6 })).toBeNull();
  });

  it('prefers the newest entry when match scores are tied', () => {
    const cache = new TimedtextUrlCache(8);
    cache.add(url('v1', 'en', 'asr', 'older'), 1);
    cache.add(url('v1', 'en', 'asr', 'newer'), 9);

    const match = cache.find({ videoId: 'v1', languageCode: 'en', kind: 'asr' });

    expect(match?.startTime).toBe(9);
    expect(new URL(match!.url).searchParams.get('pot')).toBe('newer');
  });

  it('refreshes duplicate observation time without growing the cache', () => {
    const cache = new TimedtextUrlCache(8);
    const same = url('v1', 'en', 'asr');
    cache.add(same, 1);
    cache.add(same, 9);

    expect(cache.size).toBe(1);
    expect(cache.find({ videoId: 'v1', afterStartTime: 5 })?.startTime).toBe(9);
  });

  it('keeps at most eight entries for a video', () => {
    const cache = new TimedtextUrlCache(8);
    for (let i = 0; i < 10; i++) {
      cache.add(url('v1', `l${i}`, 'asr', `p${i}`), i);
    }

    expect(cache.sizeForVideo('v1')).toBe(8);
  });

  it('evicts the oldest same-video entry without affecting another video', () => {
    const cache = new TimedtextUrlCache(2);
    cache.add(url('v1', 'old', 'asr', 'oldest'), 1);
    cache.add(url('v2', 'isolated', 'asr', 'other'), 2);
    cache.add(url('v1', 'middle', 'asr', 'middle'), 3);
    cache.add(url('v1', 'new', 'asr', 'newest'), 4);

    expect(cache.sizeForVideo('v1')).toBe(2);
    expect(cache.sizeForVideo('v2')).toBe(1);
    expect(cache.find({ videoId: 'v1', languageCode: 'old', kind: 'asr' })?.languageCode)
      .toBe('new');
    expect(cache.find({ videoId: 'v2' })?.languageCode).toBe('isolated');
  });
});

describe('toJson3TimedtextUrl', () => {
  it('preserves POT while forcing json3 and rejects a video ID mismatch', () => {
    const normalized = toJson3TimedtextUrl(url('v1', 'en'), 'v1');

    expect(normalized).toContain('pot=proof');
    expect(normalized).toContain('fmt=json3');
    expect(toJson3TimedtextUrl(url('v2', 'en'), 'v1')).toBeNull();
  });

  it('replaces an existing format while preserving POT and unrelated parameters', () => {
    const normalized = toJson3TimedtextUrl(
      'https://www.youtube.com/api/timedtext?v=v1&pot=proof&fmt=srv3&lang=en&name=English',
      'v1',
    );
    const parsed = new URL(normalized!);

    expect(parsed.searchParams.getAll('fmt')).toEqual(['json3']);
    expect(parsed.searchParams.get('pot')).toBe('proof');
    expect(parsed.searchParams.get('lang')).toBe('en');
    expect(parsed.searchParams.get('name')).toBe('English');
  });
});
