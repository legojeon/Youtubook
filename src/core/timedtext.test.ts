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
});

describe('toJson3TimedtextUrl', () => {
  it('preserves POT while forcing json3 and rejects a video ID mismatch', () => {
    const normalized = toJson3TimedtextUrl(url('v1', 'en'), 'v1');

    expect(normalized).toContain('pot=proof');
    expect(normalized).toContain('fmt=json3');
    expect(toJson3TimedtextUrl(url('v2', 'en'), 'v1')).toBeNull();
  });
});
