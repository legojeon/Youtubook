import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import type { Msg } from '../messages';
import {
  createPendingSession,
  getPendingFrames,
  getPendingSession,
  getSession,
  saveSession,
} from '../storage/db';
import {
  createSessionMessageHandler,
  PENDING_SESSION_TTL_MS,
  type BackgroundMessageDeps,
} from './session-protocol';

const jpegWithInteriorBase64Chars = (chars: number): string =>
  `data:image/jpeg;base64,/9j/${'A'.repeat(chars)}/9k=`;

const youtubeSender = (overrides: Partial<chrome.runtime.MessageSender> = {}): chrome.runtime.MessageSender => ({
  tab: { id: 7 } as chrome.tabs.Tab,
  frameId: 0,
  url: 'https://www.youtube.com/watch?v=video-1',
  ...overrides,
});

const begin: Extract<Msg, { type: 'SESSION_BEGIN' }> = {
  type: 'SESSION_BEGIN',
  meta: {
    id: 'session-1', videoId: 'video-1', title: 'Video',
    videoUrl: 'https://www.youtube.com/watch?v=video-1', tabId: -1,
    durationSec: 1, videoWidth: 1920, videoHeight: 1080,
    sampleIntervalSec: 1, sensitivity: 5, captionsAvailable: false,
    truncated: false, createdAt: 1,
  },
  scores: [0],
  cues: [],
  ranges: [{ startSec: 0, endSec: 1, repSec: 0.5 }],
};

function deps(overrides: Partial<BackgroundMessageDeps> = {}): BackgroundMessageDeps {
  return {
    now: () => 1,
    resultsUrl: 'chrome-extension://test/src/results/results.html',
    openOrFocusResults: async () => {},
    broadcast: async () => {},
    sendToTab: async () => ({ ok: true }),
    ...overrides,
  };
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory() as unknown as IDBFactory;
});

describe('extraction protocol persistence', () => {
  it('survives a simulated worker restart from begin through commit', async () => {
    const firstWorker = createSessionMessageHandler(deps());
    expect(await firstWorker(begin, youtubeSender())).toEqual({ ok: true });
    expect(await firstWorker({
      type: 'SESSION_THUMBS_CHUNK', sessionId: 'session-1', startIndex: 0, thumbs: ['thumb'],
    }, youtubeSender())).toEqual({ ok: true });
    expect(await firstWorker({
      type: 'SESSION_IMAGE', sessionId: 'session-1', key: '0.50',
      dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
    }, youtubeSender())).toEqual({ ok: true });

    const restartedWorker = createSessionMessageHandler(deps());
    expect(await restartedWorker({
      type: 'SESSION_COMMIT', sessionId: 'session-1',
    }, youtubeSender())).toEqual({ ok: true });

    expect((await getSession('session-1'))?.images).toEqual({
      '0.50': 'data:image/jpeg;base64,/9j/2Q==',
    });
    expect(await getPendingSession('session-1')).toBeNull();
    expect(await getPendingFrames('session-1')).toEqual({});
  });

  it('captionLang을 보존해 저장한다', async () => {
    const worker = createSessionMessageHandler(deps());
    const withLang = { ...begin, meta: { ...begin.meta, captionLang: 'en' } };
    expect(await worker(withLang, youtubeSender())).toEqual({ ok: true });
    expect(await worker({
      type: 'SESSION_THUMBS_CHUNK', sessionId: 'session-1', startIndex: 0, thumbs: ['thumb'],
    }, youtubeSender())).toEqual({ ok: true });
    expect(await worker({
      type: 'SESSION_IMAGE', sessionId: 'session-1', key: '0.50',
      dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
    }, youtubeSender())).toEqual({ ok: true });
    const committed = await worker({ type: 'SESSION_COMMIT', sessionId: 'session-1' }, youtubeSender());
    expect(committed).toEqual({ ok: true });
    const stored = await getSession('session-1');
    expect(stored?.meta.captionLang).toBe('en');
  });

  it('keeps an incomplete restarted session pending when commit fails', async () => {
    expect(await createSessionMessageHandler(deps())(begin, youtubeSender())).toEqual({ ok: true });

    const response = await createSessionMessageHandler(deps())({
      type: 'SESSION_COMMIT', sessionId: 'session-1',
    }, youtubeSender());

    expect(response.ok).toBe(false);
    expect(response.reason).toContain('썸네일');
    expect(await getPendingSession('session-1')).not.toBeNull();
  });

  it('cleans abandoned pending records older than the documented TTL on begin', async () => {
    await createPendingSession({
      ...(() => {
        const { type: _type, ...data } = begin;
        return { ...data, thumbs: [] };
      })(),
      meta: { ...begin.meta, id: 'stale' },
      updatedAt: 1,
    });
    const now = PENDING_SESSION_TTL_MS + 2;

    expect(await createSessionMessageHandler(deps({ now: () => now }))(
      begin,
      youtubeSender(),
    )).toEqual({ ok: true });

    expect(await getPendingSession('stale')).toBeNull();
    expect(await getPendingSession('session-1')).not.toBeNull();
  });

  it.each([
    ['missing ID', { meta: { ...begin.meta, id: '' } }],
    ['malformed metadata URL', { meta: { ...begin.meta, videoUrl: 'not a URL' } }],
    ['caption language too long', { meta: { ...begin.meta, captionLang: 'x'.repeat(65) } }],
  ])('rejects begin with %s without mutating pending data', async (_label, patch) => {
    const response = await createSessionMessageHandler(deps())(
      { ...begin, ...patch } as typeof begin,
      youtubeSender(),
    );

    expect(response.ok).toBe(false);
    expect(await getPendingSession('session-1')).toBeNull();
  });

  it.each([
    ['invalid metadata type', { meta: { ...begin.meta, title: 42 } }],
    ['duration above the supported bound', { meta: { ...begin.meta, durationSec: 7200.01 } }],
    ['cue outside the video duration', {
      cues: [{ startSec: 0, endSec: 2, text: 'caption' }],
    }],
    ['oversized cue text', {
      cues: [{ startSec: 0, endSec: 1, text: 'x'.repeat(10_001) }],
    }],
    ['overlapping ranges', {
      ranges: [
        { startSec: 0, endSec: 0.75, repSec: 0.5 },
        { startSec: 0.5, endSec: 1, repSec: 0.75 },
      ],
    }],
    ['too many ranges', {
      ranges: Array.from({ length: 301 }, (_, i) => ({
        startSec: i / 301,
        endSec: (i + 1) / 301,
        repSec: (i + 0.5) / 301,
      })),
    }],
  ])('rejects %s without replacing existing pending data', async (_label, patch) => {
    const handle = createSessionMessageHandler(deps());
    expect(await handle(begin, youtubeSender())).toEqual({ ok: true });
    const original = await getPendingSession('session-1');

    const response = await handle({ ...begin, ...patch } as typeof begin, youtubeSender());

    expect(response.ok).toBe(false);
    expect(await getPendingSession('session-1')).toEqual(original);
  });

  it('accepts a fully populated production payload at supported bounds', async () => {
    const payload: typeof begin = {
      ...begin,
      meta: {
        ...begin.meta,
        title: 'Production video',
        durationSec: 7200,
        videoWidth: 3840,
        videoHeight: 2160,
        sampleIntervalSec: 2,
        sensitivity: 10,
        captionsAvailable: true,
        captionStatus: 'available',
        truncated: true,
        createdAt: 1_700_000_000_000,
      },
      scores: [0, 12],
      cues: [{ startSec: 0, endSec: 2, text: 'caption' }],
      ranges: [{ startSec: 0, endSec: 7200, repSec: 3600 }],
    };

    expect(await createSessionMessageHandler(deps())(payload, youtubeSender()))
      .toEqual({ ok: true });
    expect((await getPendingSession('session-1'))?.meta.title).toBe('Production video');
  });

  it('persists only canonical known fields from a valid begin payload', async () => {
    const payload = {
      ...begin,
      meta: { ...begin.meta, ignored: 'meta-extra' },
      cues: [{ startSec: 0, endSec: 1, text: 'caption', ignored: 'cue-extra' }],
      ranges: [{ ...begin.ranges[0], ignored: 'range-extra' }],
      ignored: 'message-extra',
    } as unknown as typeof begin;

    expect(await createSessionMessageHandler(deps())(payload, youtubeSender()))
      .toEqual({ ok: true });
    const stored = await getPendingSession('session-1');

    expect(stored?.meta).not.toHaveProperty('ignored');
    expect(stored?.cues[0]).toEqual({ startSec: 0, endSec: 1, text: 'caption' });
    expect(stored?.ranges[0]).toEqual({ startSec: 0, endSec: 1, repSec: 0.5 });
    expect(stored).not.toHaveProperty('ignored');
  });

  it.each([
    ['aggregate cue text', Array.from({ length: 101 }, () => ({
      startSec: 0, endSec: 1, text: 'x'.repeat(10_000),
    }))],
    ['aggregate session size', Array.from({ length: 100_000 }, () => ({
      startSec: 0, endSec: 1, text: 'x',
    }))],
  ])('rejects an over-budget %s payload without replacing pending data', async (_label, cues) => {
    const handle = createSessionMessageHandler(deps());
    await handle(begin, youtubeSender());
    const original = await getPendingSession('session-1');

    const response = await handle({ ...begin, cues }, youtubeSender());

    expect(response.ok).toBe(false);
    expect(await getPendingSession('session-1')).toEqual(original);
  });

  it.each([
    ['finalize', { storage: { finalizePendingSession: async () => { throw new Error('save failed'); } } }],
    ['open', { openOrFocusResults: async () => { throw new Error('open failed'); } }],
  ])('retains persisted pending records when %s fails', async (_label, failureDeps) => {
    const handle = createSessionMessageHandler(deps(failureDeps));
    await handle(begin, youtubeSender());
    await handle({
      type: 'SESSION_THUMBS_CHUNK', sessionId: 'session-1', startIndex: 0, thumbs: ['thumb'],
    }, youtubeSender());
    await handle({
      type: 'SESSION_IMAGE', sessionId: 'session-1', key: '0.50',
      dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
    }, youtubeSender());

    const response = await handle({
      type: 'SESSION_COMMIT', sessionId: 'session-1',
    }, youtubeSender());

    expect(response.ok).toBe(false);
    expect(await getPendingSession('session-1')).not.toBeNull();
    expect(await getPendingFrames('session-1')).toHaveProperty('0.50');
  });
});

describe('sender and session validation', () => {
  it.each([null, undefined, 1, {}, { type: 1 }])(
    'safely rejects malformed runtime input %#',
    async value => {
      await expect(createSessionMessageHandler(deps())(
        value as unknown as Msg,
        youtubeSender(),
      )).resolves.toMatchObject({ ok: false });
    },
  );

  it('binds SESSION_BEGIN and later uploads to the video ID in the sender URL', async () => {
    const handle = createSessionMessageHandler(deps());

    expect((await handle(begin, youtubeSender({
      url: 'https://www.youtube.com/watch?v=another-video',
    }))).ok).toBe(false);
    expect(await getPendingSession('session-1')).toBeNull();

    expect((await handle(begin, youtubeSender())).ok).toBe(true);
    expect((await handle({
      type: 'SESSION_THUMBS_CHUNK', sessionId: 'session-1', startIndex: 0, thumbs: ['thumb'],
    }, youtubeSender({ url: 'https://www.youtube.com/watch?v=another-video' }))).ok).toBe(false);
    expect((await getPendingSession('session-1'))?.thumbs).toEqual([]);
  });

  it.each([
    ['missing tab', { tab: undefined }],
    ['wrong frame', { frameId: 1 }],
    ['wrong origin', { url: 'https://example.com/watch?v=video-1' }],
    ['wrong path', { url: 'https://www.youtube.com/results?search_query=x' }],
    ['malformed URL', { url: 'not a URL' }],
  ])('rejects %s without creating pending data', async (_label, overrides) => {
    const response = await createSessionMessageHandler(deps())(
      begin,
      youtubeSender(overrides as Partial<chrome.runtime.MessageSender>),
    );

    expect(response.ok).toBe(false);
    expect(response.reason).toBeTruthy();
    expect(await getPendingSession('session-1')).toBeNull();
  });

  it('accepts a SPA sender whose frame url lags but whose tab url is the live /watch page', async () => {
    // Content script survives YouTube's pushState navigation: sender.url is the
    // stale committed doc url (home), sender.tab.url is the live /watch url.
    const spaSender = youtubeSender({
      url: 'https://www.youtube.com/',
      tab: { id: 7, url: 'https://www.youtube.com/watch?v=video-1' } as chrome.tabs.Tab,
    });
    expect((await createSessionMessageHandler(deps())(begin, spaSender)).ok).toBe(true);
    expect(await getPendingSession('session-1')).not.toBeNull();
  });

  it('rejects when neither the frame url nor the tab url is a /watch page', async () => {
    const nonWatch = youtubeSender({
      url: 'https://www.youtube.com/',
      tab: { id: 7, url: 'https://www.youtube.com/feed/subscriptions' } as chrome.tabs.Tab,
    });
    const response = await createSessionMessageHandler(deps())(begin, nonWatch);
    expect(response.ok).toBe(false);
    expect(await getPendingSession('session-1')).toBeNull();
  });

  it('rejects wrong session and wrong tab without changing thumbnails', async () => {
    const handle = createSessionMessageHandler(deps());
    await handle(begin, youtubeSender());

    expect((await handle({
      type: 'SESSION_THUMBS_CHUNK', sessionId: 'other', startIndex: 0, thumbs: ['wrong'],
    }, youtubeSender())).ok).toBe(false);
    expect((await handle({
      type: 'SESSION_THUMBS_CHUNK', sessionId: 'session-1', startIndex: 0, thumbs: ['wrong'],
    }, youtubeSender({ tab: { id: 8 } as chrome.tabs.Tab }))).ok).toBe(false);
    expect((await getPendingSession('session-1'))?.thumbs).toEqual([]);
  });

  it('accepts REQUEST_CAPTURES only from the top-level results page', async () => {
    const sent = vi.fn(async () => ({ ok: true }));
    const handle = createSessionMessageHandler(deps({ sendToTab: sent }));
    await handle(begin, youtubeSender());
    await handle({
      type: 'SESSION_THUMBS_CHUNK', sessionId: 'session-1', startIndex: 0, thumbs: ['thumb'],
    }, youtubeSender());
    await handle({
      type: 'SESSION_IMAGE', sessionId: 'session-1', key: '0.50',
      dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
    }, youtubeSender());
    await handle({ type: 'SESSION_COMMIT', sessionId: 'session-1' }, youtubeSender());

    const request: Msg = { type: 'REQUEST_CAPTURES', sessionId: 'session-1', reps: [] };
    expect((await handle(request, { url: 'https://www.youtube.com/watch?v=video-1' })).ok).toBe(false);
    expect((await handle(request, {
      frameId: 1,
      url: 'chrome-extension://test/src/results/results.html?session=session-1',
    })).ok).toBe(false);
    expect((await handle(request, {
      frameId: 0,
      url: 'chrome-extension://test/src/results/results.html?session=session-1',
    })).ok).toBe(true);
    expect(sent).toHaveBeenCalledOnce();
  });

  it('persists FRAME_UPLOAD before broadcasting FRAME_ACCEPTED', async () => {
    const broadcast = vi.fn(async () => {});
    const handle = createSessionMessageHandler(deps({ broadcast }));
    await handle(begin, youtubeSender());
    await handle({
      type: 'SESSION_THUMBS_CHUNK', sessionId: 'session-1', startIndex: 0, thumbs: ['thumb'],
    }, youtubeSender());
    await handle({
      type: 'SESSION_IMAGE', sessionId: 'session-1', key: '0.50',
      dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
    }, youtubeSender());
    await handle({ type: 'SESSION_COMMIT', sessionId: 'session-1' }, youtubeSender());

    const frame: Msg = {
      type: 'FRAME_UPLOAD', sessionId: 'session-1', key: '0.50',
      dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
    };
    expect((await handle(frame, youtubeSender({ tab: { id: 8 } as chrome.tabs.Tab }))).ok).toBe(false);
    expect((await handle(frame, youtubeSender({ url: 'https://example.com/watch?v=video-1' }))).ok)
      .toBe(false);
    expect((await handle(frame, youtubeSender())).ok).toBe(true);
    expect((await getSession('session-1'))?.images['0.50']).toContain('image/jpeg');
    expect(broadcast).toHaveBeenCalledWith({
      ...frame,
      type: 'FRAME_ACCEPTED',
    });
  });

  it('does not broadcast a rejected FRAME_UPLOAD', async () => {
    const broadcast = vi.fn(async () => {});
    const handle = createSessionMessageHandler(deps({ broadcast }));

    const response = await handle({
      type: 'FRAME_UPLOAD', sessionId: 'missing', key: '0.50',
      dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
    }, youtubeSender());

    expect(response.ok).toBe(false);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('keeps a persisted FRAME_UPLOAD successful when broadcast delivery fails', async () => {
    const handle = createSessionMessageHandler(deps({
      broadcast: async () => { throw new Error('no results listener'); },
    }));
    await handle(begin, youtubeSender());
    await handle({
      type: 'SESSION_THUMBS_CHUNK', sessionId: 'session-1', startIndex: 0, thumbs: ['thumb'],
    }, youtubeSender());
    await handle({
      type: 'SESSION_IMAGE', sessionId: 'session-1', key: '0.50',
      dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
    }, youtubeSender());
    await handle({ type: 'SESSION_COMMIT', sessionId: 'session-1' }, youtubeSender());

    const response = await handle({
      type: 'FRAME_UPLOAD', sessionId: 'session-1', key: '0.50',
      dataUrl: 'data:image/jpeg;base64,/9j/AAAA/9k=',
    }, youtubeSender());

    expect(response).toEqual({ ok: true });
    expect((await getSession('session-1'))?.images['0.50'])
      .toBe('data:image/jpeg;base64,/9j/AAAA/9k=');
  });
});

describe('committed frame validation', () => {
  it.each([
    ['invalid session ID', '', '0.50', 'data:image/jpeg;base64,/9j/2Q=='],
    ['unexpected key', 'session-1', '9.99', 'data:image/jpeg;base64,/9j/2Q=='],
    ['missing JPEG markers', 'session-1', '0.50', 'data:image/jpeg;base64,AAAA'],
    [
      'oversized JPEG',
      'session-1',
      '0.50',
      jpegWithInteriorBase64Chars(16 * 1024 * 1024),
    ],
  ])('rejects %s without mutating the committed session', async (
    _label,
    sessionId,
    key,
    dataUrl,
  ) => {
    const handle = createSessionMessageHandler(deps());
    await handle(begin, youtubeSender());
    await handle({
      type: 'SESSION_THUMBS_CHUNK', sessionId: 'session-1', startIndex: 0, thumbs: ['thumb'],
    }, youtubeSender());
    await handle({
      type: 'SESSION_IMAGE', sessionId: 'session-1', key: '0.50',
      dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
    }, youtubeSender());
    await handle({ type: 'SESSION_COMMIT', sessionId: 'session-1' }, youtubeSender());
    const original = await getSession('session-1');

    const response = await handle({ type: 'FRAME_UPLOAD', sessionId, key, dataUrl }, youtubeSender());

    expect(response.ok).toBe(false);
    expect(await getSession('session-1')).toEqual(original);
  });

  it('rejects a frame that exceeds the aggregate committed-image budget', async () => {
    const ranges = Array.from({ length: 9 }, (_, i) => ({
      startSec: i, endSec: i + 1, repSec: i + 0.5,
    }));
    const nearLimit = jpegWithInteriorBase64Chars(15 * 1024 * 1024);
    const images = Object.fromEntries(
      ranges.slice(0, 8).map(range => [range.repSec.toFixed(2), nearLimit]),
    );
    await saveSession({
      meta: { ...begin.meta, tabId: 7, durationSec: ranges.length },
      scores: [0],
      thumbs: ['thumb'],
      cues: [],
      ranges,
      images,
    });
    const handle = createSessionMessageHandler(deps());

    const response = await handle({
      type: 'FRAME_UPLOAD', sessionId: 'session-1', key: '8.50', dataUrl: nearLimit,
    }, youtubeSender());

    expect(response.ok).toBe(false);
    expect((await getSession('session-1'))?.images).toEqual(images);
  });
});

describe('pending image validation', () => {
  it.each([
    ['unexpected key', '9.99', 'data:image/jpeg;base64,/9j/2Q=='],
    ['non-JPEG', '0.50', 'data:image/png;base64,/9j/2Q=='],
    ['malformed JPEG', '0.50', 'data:image/jpeg;base64,%%%'],
    ['oversized JPEG', '0.50', jpegWithInteriorBase64Chars(16 * 1024 * 1024)],
  ])('rejects %s before persistence', async (_label, key, dataUrl) => {
    const handle = createSessionMessageHandler(deps());
    await handle(begin, youtubeSender());

    const response = await handle({
      type: 'SESSION_IMAGE', sessionId: 'session-1', key, dataUrl,
    }, youtubeSender());

    expect(response.ok).toBe(false);
    expect(await getPendingFrames('session-1')).toEqual({});
  });

  it('rejects an aggregate-over-budget frame without replacing existing data', async () => {
    const ranges = Array.from({ length: 9 }, (_, i) => ({
      startSec: i, endSec: i + 1, repSec: i + 0.5,
    }));
    const handle = createSessionMessageHandler(deps());
    await handle({
      ...begin,
      meta: { ...begin.meta, durationSec: ranges.length },
      ranges,
    }, youtubeSender());
    const nearLimit = jpegWithInteriorBase64Chars(15 * 1024 * 1024);
    for (const range of ranges.slice(0, 8)) {
      expect((await handle({
        type: 'SESSION_IMAGE', sessionId: 'session-1', key: range.repSec.toFixed(2),
        dataUrl: nearLimit,
      }, youtubeSender())).ok).toBe(true);
    }

    const response = await handle({
      type: 'SESSION_IMAGE', sessionId: 'session-1', key: '8.50', dataUrl: nearLimit,
    }, youtubeSender());

    expect(response.ok).toBe(false);
    expect(Object.keys(await getPendingFrames('session-1'))).toHaveLength(8);
  });
});
