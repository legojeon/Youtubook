import { describe, expect, it, vi } from 'vitest';
import type { CaptionTrackInfo } from '../core/captions';
import { MAX_CAPTION_EVENTS } from '../core/limits';
import type { ObservedTimedtextUrl } from '../core/timedtext';
import { fetchCaptions, type CaptionFetchDeps } from './captions-fetch';

const track: CaptionTrackInfo = {
  baseUrl: 'https://www.youtube.com/api/timedtext?v=video-1&lang=en',
  languageCode: 'en',
  kind: 'asr',
};

const json3 = JSON.stringify({
  events: [{ tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: 'hello' }] }],
});

const observed = (
  url = 'https://www.youtube.com/api/timedtext?v=video-1&lang=en&kind=asr&pot=proof',
  startTime = 10,
):
ObservedTimedtextUrl => ({
  url,
  videoId: 'video-1',
  languageCode: 'en',
  kind: 'asr',
  startTime,
});

interface ButtonHarness {
  button: Pick<HTMLButtonElement, 'getAttribute' | 'click'>;
  clicks: boolean[];
  isOn: () => boolean;
}

function buttonHarness(initiallyOn: boolean): ButtonHarness {
  let on = initiallyOn;
  const clicks: boolean[] = [];
  return {
    button: {
      getAttribute(name: string) {
        if (name === 'aria-disabled') return 'false';
        if (name === 'aria-pressed') return String(on);
        return null;
      },
      click() {
        on = !on;
        clicks.push(on);
      },
    },
    clicks,
    isOn: () => on,
  };
}

function deps(overrides: Partial<CaptionFetchDeps> = {}): CaptionFetchDeps {
  return {
    requestText: vi.fn(async () => ({ ok: false, text: '' })),
    getObserved: vi.fn(async () => null),
    waitObserved: vi.fn(async () => null),
    getSubtitleButton: () => null,
    nextTurn: async () => {},
    preferredLanguages: ['en'],
    ...overrides,
  };
}

describe('fetchCaptions', () => {
  it('returns absent when there is no caption track', async () => {
    await expect(fetchCaptions([], 'video-1', deps())).resolves.toEqual({
      status: 'absent',
      cues: [],
    });
  });

  it('returns available cues from a direct JSON3 request', async () => {
    const requestText = vi.fn(async () => ({ ok: true, text: json3 }));

    const result = await fetchCaptions([track], 'video-1', deps({ requestText }));

    expect(result).toEqual({
      status: 'available',
      cues: [{ startSec: 1, endSec: 3, text: 'hello' }],
    });
    expect(requestText).toHaveBeenCalledWith(`${track.baseUrl}&fmt=json3`);
  });

  it('reuses an existing observed POT URL after a direct empty response', async () => {
    const requestText = vi.fn(async (url: string) => (
      url.includes('pot=proof')
        ? { ok: true, text: json3 }
        : { ok: true, text: '' }
    ));
    const getObserved = vi.fn(async () => observed());

    const result = await fetchCaptions(
      [track],
      'video-1',
      deps({ requestText, getObserved }),
    );

    expect(result.status).toBe('available');
    const reusedUrl = requestText.mock.calls[1][0];
    expect(new URL(reusedUrl).searchParams.get('pot')).toBe('proof');
    expect(new URL(reusedUrl).searchParams.get('fmt')).toBe('json3');
    expect(getObserved).toHaveBeenCalledWith({
      videoId: 'video-1',
      languageCode: 'en',
      kind: 'asr',
    });
  });

  it('triggers the player when an existing observed POT URL is empty', async () => {
    const harness = buttonHarness(false);
    const requestText = vi.fn(async (url: string) => (
      url.includes('pot=fresh') ? { ok: true, text: json3 } : { ok: true, text: '' }
    ));

    const result = await fetchCaptions([track], 'video-1', deps({
      requestText,
      getObserved: vi.fn(async () => observed(
        'https://www.youtube.com/api/timedtext?v=video-1&lang=en&kind=asr&pot=expired',
        4_242,
      )),
      waitObserved: vi.fn(async query => {
        expect(query.afterStartTime).toBe(4_242);
        return observed(
          'https://www.youtube.com/api/timedtext?v=video-1&lang=en&kind=asr&pot=fresh',
        );
      }),
      getSubtitleButton: () => harness.button,
    }));

    expect(result.status).toBe('available');
    expect(harness.clicks).toEqual([true, false]);
  });

  it('returns fetch-failed rather than absent when no observer or button is available', async () => {
    await expect(fetchCaptions([track], 'video-1', deps())).resolves.toEqual({
      status: 'fetch-failed',
      reason: 'no-observed-url',
      cues: [],
    });
  });

  it('turns CC on, waits for a fresh URL, and restores it off when initially off', async () => {
    const harness = buttonHarness(false);
    const requestText = vi.fn(async (url: string) => (
      url.includes('pot=proof') ? { ok: true, text: json3 } : { ok: true, text: '' }
    ));
    const waitObserved = vi.fn(async () => observed());

    const result = await fetchCaptions([track], 'video-1', deps({
      requestText,
      waitObserved,
      getSubtitleButton: () => harness.button,
    }));

    expect(result.status).toBe('available');
    expect(harness.clicks).toEqual([true, false]);
    expect(harness.isOn()).toBe(false);
    expect(waitObserved).toHaveBeenCalledWith(expect.objectContaining({
      videoId: 'video-1',
      languageCode: 'en',
      kind: 'asr',
      afterStartTime: expect.any(Number),
    }));
  });

  it('cycles CC off and on and leaves it on when initially on', async () => {
    const harness = buttonHarness(true);
    const order: string[] = [];
    const nextTurn = vi.fn(async () => { order.push('turn'); });
    const waitObserved = vi.fn(async () => {
      order.push('wait');
      return observed();
    });

    const result = await fetchCaptions([track], 'video-1', deps({
      requestText: vi.fn(async (url: string) => (
        url.includes('pot=proof') ? { ok: true, text: json3 } : { ok: true, text: '' }
      )),
      waitObserved,
      getSubtitleButton: () => harness.button,
      nextTurn,
    }));

    expect(result.status).toBe('available');
    expect(harness.clicks).toEqual([false, true]);
    expect(harness.isOn()).toBe(true);
    expect(order).toEqual(['turn', 'wait']);
  });

  it('restores CC on when cycling fails between the off and on clicks', async () => {
    const harness = buttonHarness(true);

    await expect(fetchCaptions([track], 'video-1', deps({
      getSubtitleButton: () => harness.button,
      nextTurn: vi.fn(async () => { throw new Error('turn failed'); }),
    }))).resolves.toEqual({
      status: 'fetch-failed',
      reason: 'player-timeout',
      cues: [],
    });
    expect(harness.clicks).toEqual([false, true]);
    expect(harness.isOn()).toBe(true);
  });

  it('reports player-timeout when waiting returns no URL', async () => {
    const harness = buttonHarness(false);

    await expect(fetchCaptions([track], 'video-1', deps({
      getSubtitleButton: () => harness.button,
    }))).resolves.toEqual({
      status: 'fetch-failed',
      reason: 'player-timeout',
      cues: [],
    });
    expect(harness.isOn()).toBe(false);
  });

  it('continues to a fresh player URL when the prior bridge lookup rejects', async () => {
    const harness = buttonHarness(false);
    const result = await fetchCaptions([track], 'video-1', deps({
      getObserved: vi.fn(async () => { throw new Error('bridge rejected'); }),
      getSubtitleButton: () => harness.button,
      waitObserved: vi.fn(async () => observed()),
      requestText: vi.fn(async (url: string) => (
        url.includes('pot=proof') ? { ok: true, text: json3 } : { ok: true, text: '' }
      )),
    }));

    expect(result.status).toBe('available');
    expect(harness.clicks).toEqual([true, false]);
  });

  it('turns a fresh bridge wait rejection into a fetch-failed result', async () => {
    const harness = buttonHarness(false);
    await expect(fetchCaptions([track], 'video-1', deps({
      getSubtitleButton: () => harness.button,
      waitObserved: vi.fn(async () => { throw new Error('bridge timeout'); }),
    }))).resolves.toEqual({
      status: 'fetch-failed',
      reason: 'player-timeout',
      cues: [],
    });
    expect(harness.isOn()).toBe(false);
  });

  it('continues to a fresh player URL after an invalid prior observed URL', async () => {
    const harness = buttonHarness(false);
    const result = await fetchCaptions([track], 'video-1', deps({
      getObserved: vi.fn(async () => observed('https://evil.example/api/timedtext?v=video-1&pot=proof')),
      getSubtitleButton: () => harness.button,
      waitObserved: vi.fn(async () => observed()),
      requestText: vi.fn(async (url: string) => (
        url.includes('pot=proof') ? { ok: true, text: json3 } : { ok: true, text: '' }
      )),
    }));

    expect(result.status).toBe('available');
    expect(harness.clicks).toEqual([true, false]);
  });

  it('continues to a fresh player URL after a prior observed parse error', async () => {
    const harness = buttonHarness(false);
    const result = await fetchCaptions([track], 'video-1', deps({
      getObserved: vi.fn(async () => observed(
        'https://www.youtube.com/api/timedtext?v=video-1&lang=en&kind=asr&pot=malformed',
      )),
      getSubtitleButton: () => harness.button,
      waitObserved: vi.fn(async () => observed()),
      requestText: vi.fn(async (url: string) => {
        if (url.includes('pot=proof')) return { ok: true, text: json3 };
        if (url.includes('pot=malformed')) return { ok: true, text: '{' };
        return { ok: true, text: '' };
      }),
    }));

    expect(result.status).toBe('available');
    expect(harness.clicks).toEqual([true, false]);
  });

  it('reports an invalid fresh observed URL explicitly', async () => {
    const harness = buttonHarness(false);

    await expect(fetchCaptions([track], 'video-1', deps({
      getSubtitleButton: () => harness.button,
      waitObserved: vi.fn(async () => observed(
        'https://evil.example/api/timedtext?v=video-1&pot=proof',
      )),
    }))).resolves.toEqual({
      status: 'fetch-failed',
      reason: 'invalid-url',
      cues: [],
    });
    expect(harness.clicks).toEqual([true, false]);
  });

  it('treats too many events from a prior observed URL as terminal', async () => {
    const harness = buttonHarness(false);
    const oversized = JSON.stringify({
      events: Array.from({ length: MAX_CAPTION_EVENTS + 1 }, () => null),
    });

    await expect(fetchCaptions([track], 'video-1', deps({
      getObserved: vi.fn(async () => observed()),
      getSubtitleButton: () => harness.button,
      requestText: vi.fn(async (url: string) => (
        url.includes('pot=proof')
          ? { ok: true, text: oversized }
          : { ok: true, text: '' }
      )),
    }))).resolves.toEqual({
      status: 'fetch-failed',
      reason: 'too-many-events',
      cues: [],
    });
    expect(harness.clicks).toEqual([]);
  });

  it('reports too many events instead of parsing them', async () => {
    const oversized = JSON.stringify({
      events: Array.from({ length: MAX_CAPTION_EVENTS + 1 }, () => null),
    });

    await expect(fetchCaptions([track], 'video-1', deps({
      requestText: vi.fn(async () => ({ ok: true, text: oversized })),
    }))).resolves.toEqual({
      status: 'fetch-failed',
      reason: 'too-many-events',
      cues: [],
    });
  });

  it('never reads Resource Timing while recovering direct-empty via a fresh observed URL', async () => {
    const original = performance.getEntriesByType;
    const getEntriesByType = vi.fn(() => { throw new Error('must not be called'); });
    Object.defineProperty(performance, 'getEntriesByType', {
      configurable: true,
      value: getEntriesByType,
    });
    try {
      const harness = buttonHarness(false);
      const result = await fetchCaptions([track], 'video-1', deps({
        requestText: vi.fn(async (url: string) => (
          url.includes('pot=proof') ? { ok: true, text: json3 } : { ok: true, text: '' }
        )),
        getObserved: vi.fn(async () => { throw new Error('bridge rejected'); }),
        waitObserved: vi.fn(async () => observed()),
        getSubtitleButton: () => harness.button,
      }));

      expect(result.status).toBe('available');
      expect(getEntriesByType).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(performance, 'getEntriesByType', {
        configurable: true,
        value: original,
      });
    }
  });
});
