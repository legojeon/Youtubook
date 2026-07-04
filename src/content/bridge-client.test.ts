import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getPlayerInfo,
  getTimedtextUrl,
  setMaxQuality,
  waitForTimedtextUrl,
} from './bridge-client';

type MessageListener = (event: MessageEvent) => void;

function installFakeWindow(replyPayload?: unknown) {
  const listeners = new Set<MessageListener>();
  const posted: Record<string, unknown>[] = [];
  const fakeWindow = {
    addEventListener: (_type: string, listener: MessageListener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: MessageListener) => listeners.delete(listener),
    postMessage: (message: Record<string, unknown>) => {
      posted.push(message);
      if (replyPayload === undefined) return;
      for (const listener of listeners) {
        listener({
          source: fakeWindow,
          data: {
            source: 'youtubook-bridge',
            reqId: message.reqId,
            payload: replyPayload,
          },
        } as unknown as MessageEvent);
      }
    },
  };
  vi.stubGlobal('window', fakeWindow);
  return { posted, listenerCount: () => listeners.size };
}

describe('bridge client', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('posts the timedtext query payload and returns the observed URL', async () => {
    const observed = {
      url: 'https://www.youtube.com/api/timedtext?v=video-1&pot=proof',
      videoId: 'video-1',
      startTime: 42,
    };
    const { posted } = installFakeWindow(observed);
    const query = { videoId: 'video-1', afterStartTime: 12 };

    await expect(getTimedtextUrl(query)).resolves.toEqual(observed);
    expect(posted[0]).toMatchObject({ cmd: 'GET_TIMEDTEXT_URL', payload: query });
  });

  it('gives the wait command a seven-second client timeout', async () => {
    installFakeWindow();
    const result = waitForTimedtextUrl({ videoId: 'video-1' });
    const settled = vi.fn();
    void result.then(settled, settled);

    await vi.advanceTimersByTimeAsync(6_999);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toHaveBeenCalledOnce();
    await expect(result).rejects.toThrow('bridge timeout: WAIT_FOR_TIMEDTEXT_URL');
  });

  it('keeps existing commands payload-free', async () => {
    const { posted } = installFakeWindow({ ok: true });

    await setMaxQuality();
    await getPlayerInfo();

    expect(posted).toHaveLength(2);
    expect(posted.every(message => !Object.hasOwn(message, 'payload'))).toBe(true);
  });

  it('aborts a timedtext wait promptly and removes all listeners and its timer', async () => {
    const { listenerCount } = installFakeWindow();
    const controller = new AbortController();
    const removeAbortListener = vi.spyOn(controller.signal, 'removeEventListener');

    const result = waitForTimedtextUrl({ videoId: 'video-1' }, controller.signal);
    expect(listenerCount()).toBe(1);

    controller.abort();

    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(listenerCount()).toBe(0);
    expect(removeAbortListener).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });
});
