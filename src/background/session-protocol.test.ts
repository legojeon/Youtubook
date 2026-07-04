import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import type { Msg } from '../messages';
import {
  createPendingSession,
  getPendingFrames,
  getPendingSession,
  getSession,
} from '../storage/db';
import {
  createSessionMessageHandler,
  PENDING_SESSION_TTL_MS,
  type BackgroundMessageDeps,
} from './session-protocol';

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
    openResults: async () => {},
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
      dataUrl: 'data:image/jpeg;base64,AAAA',
    }, youtubeSender())).toEqual({ ok: true });

    const restartedWorker = createSessionMessageHandler(deps());
    expect(await restartedWorker({
      type: 'SESSION_COMMIT', sessionId: 'session-1',
    }, youtubeSender())).toEqual({ ok: true });

    expect((await getSession('session-1'))?.images).toEqual({
      '0.50': 'data:image/jpeg;base64,AAAA',
    });
    expect(await getPendingSession('session-1')).toBeNull();
    expect(await getPendingFrames('session-1')).toEqual({});
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
  ])('rejects begin with %s without mutating pending data', async (_label, patch) => {
    const response = await createSessionMessageHandler(deps())(
      { ...begin, ...patch } as typeof begin,
      youtubeSender(),
    );

    expect(response.ok).toBe(false);
    expect(await getPendingSession('session-1')).toBeNull();
  });

  it.each([
    ['save', { storage: { saveSession: async () => { throw new Error('save failed'); } } }],
    ['open', { openResults: async () => { throw new Error('open failed'); } }],
  ])('retains persisted pending records when %s fails', async (_label, failureDeps) => {
    const handle = createSessionMessageHandler(deps(failureDeps));
    await handle(begin, youtubeSender());
    await handle({
      type: 'SESSION_THUMBS_CHUNK', sessionId: 'session-1', startIndex: 0, thumbs: ['thumb'],
    }, youtubeSender());
    await handle({
      type: 'SESSION_IMAGE', sessionId: 'session-1', key: '0.50',
      dataUrl: 'data:image/jpeg;base64,AAAA',
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

  it('accepts REQUEST_CAPTURES only from the results page and FRAME_READY only from the owning YouTube tab', async () => {
    const sent = vi.fn(async () => ({ ok: true }));
    const handle = createSessionMessageHandler(deps({ sendToTab: sent }));
    await handle(begin, youtubeSender());
    await handle({
      type: 'SESSION_THUMBS_CHUNK', sessionId: 'session-1', startIndex: 0, thumbs: ['thumb'],
    }, youtubeSender());
    await handle({
      type: 'SESSION_IMAGE', sessionId: 'session-1', key: '0.50',
      dataUrl: 'data:image/jpeg;base64,AAAA',
    }, youtubeSender());
    await handle({ type: 'SESSION_COMMIT', sessionId: 'session-1' }, youtubeSender());

    const request: Msg = { type: 'REQUEST_CAPTURES', sessionId: 'session-1', reps: [] };
    expect((await handle(request, { url: 'https://www.youtube.com/watch?v=video-1' })).ok).toBe(false);
    expect((await handle(request, {
      url: 'chrome-extension://test/src/results/results.html?session=session-1',
    })).ok).toBe(true);
    expect(sent).toHaveBeenCalledOnce();

    const frame: Msg = {
      type: 'FRAME_READY', sessionId: 'session-1', key: '0.50',
      dataUrl: 'data:image/jpeg;base64,AAAA',
    };
    expect((await handle(frame, youtubeSender({ tab: { id: 8 } as chrome.tabs.Tab }))).ok).toBe(false);
    expect((await handle(frame, youtubeSender({ url: 'https://example.com/watch?v=video-1' }))).ok)
      .toBe(false);
    expect((await handle(frame, youtubeSender())).ok).toBe(true);
    expect((await getSession('session-1'))?.images['0.50']).toContain('image/jpeg');
  });
});

describe('pending image validation', () => {
  it.each([
    ['unexpected key', '9.99', 'data:image/jpeg;base64,AAAA'],
    ['non-JPEG', '0.50', 'data:image/png;base64,AAAA'],
    ['malformed JPEG', '0.50', 'data:image/jpeg;base64,%%%'],
    ['oversized JPEG', '0.50', `data:image/jpeg;base64,${'A'.repeat(16 * 1024 * 1024)}`],
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
    await handle({ ...begin, ranges }, youtubeSender());
    const nearLimit = `data:image/jpeg;base64,${'A'.repeat(15 * 1024 * 1024)}`;
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
