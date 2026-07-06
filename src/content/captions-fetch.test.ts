import { describe, expect, it, vi } from 'vitest';
import type { CaptionTrackInfo } from '../core/captions';
import { MAX_CAPTION_EVENTS } from '../core/limits';
import type { ObservedTimedtextUrl } from '../core/timedtext';
import {
  fetchCaptions,
  type CaptionFetchDeps,
  waitForBrowserPressed,
} from './captions-fetch';

const track: CaptionTrackInfo = {
  baseUrl: 'https://www.youtube.com/api/timedtext?v=video-1&lang=en',
  languageCode: 'en',
  kind: 'asr',
};

const json3 = JSON.stringify({
  events: [{ tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: 'hello' }] }],
});

// Not valid JSON — JSON.parse throws, so the fetch reports parse-error.
// (Individually malformed cues are now skipped/clamped, not treated as parse-error.)
const malformedJson3 = '{ "events": [ { "tStartMs":';

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
  settle: (expected: boolean) => boolean;
}

function buttonHarness(initiallyOn: boolean, delayed = false): ButtonHarness {
  let on = initiallyOn;
  let pending: boolean | null = null;
  const clicks: boolean[] = [];
  return {
    button: {
      getAttribute(name: string) {
        if (name === 'aria-disabled') return 'false';
        if (name === 'aria-pressed') return String(on);
        return null;
      },
      click() {
        const expected = !on;
        clicks.push(expected);
        if (delayed) pending = expected;
        else on = expected;
      },
    },
    clicks,
    isOn: () => on,
    settle(expected: boolean) {
      if (pending === expected) {
        on = expected;
        pending = null;
      }
      return on === expected;
    },
  };
}

type TestDeps = CaptionFetchDeps & {
  now(): number;
  waitForPressed(button: Pick<HTMLButtonElement, 'getAttribute' | 'click'>, expected: boolean):
  Promise<boolean>;
};

function deps(overrides: Partial<TestDeps> = {}): TestDeps {
  return {
    requestText: vi.fn(async () => ({ ok: false, text: '' })),
    getObserved: vi.fn(async () => null),
    waitObserved: vi.fn(async () => null),
    getSubtitleButton: () => null,
    now: () => 100,
    waitForPressed: async (button, expected) =>
      button.getAttribute('aria-pressed') === String(expected),
    preferredLanguages: ['en'],
    ...overrides,
  } as TestDeps;
}

describe('fetchCaptions', () => {
  it('passes cancellation to a direct request and rethrows AbortError', async () => {
    const controller = new AbortController();
    const requestText = vi.fn((_url: string, signal?: AbortSignal) =>
      new Promise<{ ok: boolean; text: string }>((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          reject(new DOMException('cancelled', 'AbortError'));
        }, { once: true });
      }));

    const result = fetchCaptions(
      [track],
      'video-1',
      controller.signal,
      deps({ requestText }),
    );
    controller.abort();

    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(requestText).toHaveBeenCalledWith(`${track.baseUrl}&fmt=json3`, controller.signal);
  });

  it('rethrows bridge-wait cancellation and restores the original CC state', async () => {
    const controller = new AbortController();
    const harness = buttonHarness(false);
    const pressedSignals: Array<AbortSignal | undefined> = [];

    const result = fetchCaptions([track], 'video-1', controller.signal, deps({
      requestText: vi.fn(async () => ({ ok: true, text: '' })),
      getObserved: vi.fn(async (_query, signal?: AbortSignal) => {
        expect(signal).toBe(controller.signal);
        return null;
      }),
      waitObserved: vi.fn(async (_query, signal?: AbortSignal) => {
        expect(signal).toBe(controller.signal);
        controller.abort();
        signal?.throwIfAborted();
        return null;
      }),
      getSubtitleButton: () => harness.button,
      waitForPressed: vi.fn(async (_button, expected, signal?: AbortSignal) => {
        pressedSignals.push(signal);
        return harness.isOn() === expected;
      }),
    }));

    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(harness.clicks).toEqual([true, false]);
    expect(harness.isOn()).toBe(false);
    expect(pressedSignals).toEqual([controller.signal, undefined]);
  });

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

  it('replaces duplicate direct format parameters with one json3 value', async () => {
    const requestText = vi.fn(async (_url: string) => ({ ok: true, text: json3 }));
    const duplicateFormatTrack = {
      ...track,
      baseUrl: `${track.baseUrl}&fmt=srv3&fmt=vtt`,
    };

    const result = await fetchCaptions(
      [duplicateFormatTrack],
      'video-1',
      deps({ requestText }),
    );

    expect(result.status).toBe('available');
    const requested = new URL(requestText.mock.calls[0][0]);
    expect(requested.searchParams.getAll('fmt')).toEqual(['json3']);
  });

  it('does not request a direct URL whose video ID does not match', async () => {
    const requestText = vi.fn(async (url: string) => (
      url.includes('pot=proof') ? { ok: true, text: json3 } : { ok: true, text: '' }
    ));
    const mismatchedTrack = {
      ...track,
      baseUrl: 'https://www.youtube.com/api/timedtext?v=other-video&lang=en',
    };

    const result = await fetchCaptions([mismatchedTrack], 'video-1', deps({
      requestText,
      getObserved: vi.fn(async () => observed()),
    }));

    expect(result.status).toBe('available');
    expect(requestText).toHaveBeenCalledTimes(1);
    expect(requestText.mock.calls[0][0]).toContain('pot=proof');
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

  it('waits for delayed CC-on and restoration transitions when initially off', async () => {
    const harness = buttonHarness(false, true);
    const waits: boolean[] = [];

    const result = await fetchCaptions([track], 'video-1', deps({
      requestText: vi.fn(async (url: string) => (
        url.includes('pot=proof') ? { ok: true, text: json3 } : { ok: true, text: '' }
      )),
      waitObserved: vi.fn(async () => observed()),
      getSubtitleButton: () => harness.button,
      waitForPressed: vi.fn(async (_button, expected: boolean) => {
        waits.push(expected);
        return harness.settle(expected);
      }),
    }));

    expect(result.status).toBe('available');
    expect(waits).toEqual([true, false]);
    expect(harness.clicks).toEqual([true, false]);
    expect(harness.isOn()).toBe(false);
  });

  it('waits for delayed CC off and on transitions when initially on', async () => {
    const harness = buttonHarness(true, true);
    const waits: boolean[] = [];

    const result = await fetchCaptions([track], 'video-1', deps({
      requestText: vi.fn(async (url: string) => (
        url.includes('pot=proof') ? { ok: true, text: json3 } : { ok: true, text: '' }
      )),
      waitObserved: vi.fn(async () => observed()),
      getSubtitleButton: () => harness.button,
      waitForPressed: vi.fn(async (_button, expected: boolean) => {
        waits.push(expected);
        return harness.settle(expected);
      }),
    }));

    expect(result.status).toBe('available');
    expect(waits).toEqual([false, true]);
    expect(harness.clicks).toEqual([false, true]);
    expect(harness.isOn()).toBe(true);
  });

  it('returns player-timeout when delayed CC restoration does not complete', async () => {
    const harness = buttonHarness(false, true);
    const waits: boolean[] = [];

    await expect(fetchCaptions([track], 'video-1', deps({
      requestText: vi.fn(async (url: string) => (
        url.includes('pot=proof') ? { ok: true, text: json3 } : { ok: true, text: '' }
      )),
      waitObserved: vi.fn(async () => observed()),
      getSubtitleButton: () => harness.button,
      waitForPressed: vi.fn(async (_button, expected: boolean) => {
        waits.push(expected);
        if (expected) return harness.settle(true);
        return false;
      }),
    }))).resolves.toEqual({
      status: 'fetch-failed',
      reason: 'player-timeout',
      cues: [],
    });

    expect(waits).toEqual([true, false]);
    expect(harness.clicks).toEqual([true, false]);
  });

  it('cycles CC off and on and leaves it on when initially on', async () => {
    const harness = buttonHarness(true);
    const order: string[] = [];
    const waitForPressed = vi.fn(async (_button, expected: boolean) => {
      order.push(`pressed:${expected}`);
      return true;
    });
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
      waitForPressed,
    }));

    expect(result.status).toBe('available');
    expect(harness.clicks).toEqual([false, true]);
    expect(harness.isOn()).toBe(true);
    expect(order).toEqual(['pressed:false', 'pressed:true', 'wait']);
  });

  it('restores CC on when waiting for the off transition fails', async () => {
    const harness = buttonHarness(true, true);
    const waits: boolean[] = [];

    await expect(fetchCaptions([track], 'video-1', deps({
      getSubtitleButton: () => harness.button,
      waitForPressed: vi.fn(async (_button, expected: boolean) => {
        waits.push(expected);
        harness.settle(expected);
        if (waits.length === 1) throw new Error('transition wait failed');
        return true;
      }),
    }))).resolves.toEqual({
      status: 'fetch-failed',
      reason: 'player-timeout',
      cues: [],
    });
    expect(harness.clicks).toEqual([false, true]);
    expect(harness.isOn()).toBe(true);
    expect(waits).toEqual([false, true]);
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

  it.each(['null', 'rejected'] as const)(
    'uses the lookup start cutoff when the prior lookup is %s',
    async outcome => {
      const harness = buttonHarness(false);
      const order: string[] = [];
      const result = await fetchCaptions([track], 'video-1', deps({
        now: () => {
          order.push('now');
          return 100;
        },
        getObserved: vi.fn(async () => {
          order.push('lookup');
          await Promise.resolve();
          if (outcome === 'rejected') throw new Error('bridge rejected');
          return null;
        }),
        getSubtitleButton: () => harness.button,
        waitObserved: vi.fn(async query => {
          expect(query.afterStartTime).toBe(100);
          return observed(undefined, 150);
        }),
        requestText: vi.fn(async (url: string) => (
          url.includes('pot=proof') ? { ok: true, text: json3 } : { ok: true, text: '' }
        )),
      }));

      expect(order.slice(0, 2)).toEqual(['now', 'lookup']);
      expect(result.status).toBe('available');
    },
  );

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

  it('reports an unparseable JSON3 response as parse-error', async () => {
    await expect(fetchCaptions([track], 'video-1', deps({
      requestText: vi.fn(async () => ({ ok: true, text: malformedJson3 })),
    }), undefined, 60)).resolves.toEqual({
      status: 'fetch-failed',
      reason: 'parse-error',
      cues: [],
    });
  });

  it('preserves a direct parse-error when player recovery produces no fresh URL', async () => {
    const harness = buttonHarness(false);

    await expect(fetchCaptions([track], 'video-1', deps({
      requestText: vi.fn(async () => ({ ok: true, text: malformedJson3 })),
      getSubtitleButton: () => harness.button,
      waitObserved: vi.fn(async () => null),
    }), undefined, 60)).resolves.toEqual({
      status: 'fetch-failed',
      reason: 'parse-error',
      cues: [],
    });
    expect(harness.clicks).toEqual([true, false]);
  });

  it('preserves a prior parse-error when a fresh response is non-ok', async () => {
    const harness = buttonHarness(false);
    const prior = observed(
      'https://www.youtube.com/api/timedtext?v=video-1&lang=en&kind=asr&pot=malformed',
    );
    const fresh = observed();

    await expect(fetchCaptions([track], 'video-1', deps({
      getObserved: vi.fn(async () => prior),
      getSubtitleButton: () => harness.button,
      waitObserved: vi.fn(async () => fresh),
      requestText: vi.fn(async (url: string) => {
        if (url.includes('pot=malformed')) return { ok: true, text: malformedJson3 };
        if (url.includes('pot=proof')) return { ok: false, text: '' };
        return { ok: true, text: '' };
      }),
    }), undefined, 60)).resolves.toEqual({
      status: 'fetch-failed',
      reason: 'parse-error',
      cues: [],
    });
    expect(harness.clicks).toEqual([true, false]);
  });

  it('returns available when a valid fresh response follows a direct parse-error', async () => {
    const harness = buttonHarness(false);
    const result = await fetchCaptions([track], 'video-1', deps({
      getSubtitleButton: () => harness.button,
      waitObserved: vi.fn(async () => observed()),
      requestText: vi.fn(async (url: string) => (
        url.includes('pot=proof')
          ? { ok: true, text: json3 }
          : { ok: true, text: malformedJson3 }
      )),
    }), undefined, 60);

    expect(result).toEqual({
      status: 'available',
      cues: [{ startSec: 1, endSec: 3, text: 'hello' }],
    });
    expect(harness.clicks).toEqual([true, false]);
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

describe('waitForBrowserPressed', () => {
  it('stops CC polling promptly when aborted and clears its timer', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const button = {
        getAttribute: () => 'false',
        click: () => {},
      };
      const result = waitForBrowserPressed(button, true, controller.signal);

      controller.abort();

      await expect(result).rejects.toMatchObject({ name: 'AbortError' });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
