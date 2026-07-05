import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type EventListener = (event: Event) => void;
type MessageListener = (event: MessageEvent) => void;

function installPageGlobals(performanceObserver: typeof PerformanceObserver) {
  const documentListeners = new Map<string, EventListener>();
  const windowListeners = new Map<string, MessageListener>();
  const fakeDocument = {
    title: 'Test - YouTube',
    getElementById: vi.fn(() => null),
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      documentListeners.set(type, listener);
    }),
  };
  const fakeWindow = {
    addEventListener: vi.fn((type: string, listener: MessageListener) => {
      windowListeners.set(type, listener);
    }),
    postMessage: vi.fn(),
  };
  vi.stubGlobal('document', fakeDocument);
  vi.stubGlobal('window', fakeWindow);
  vi.stubGlobal('PerformanceObserver', performanceObserver);
  return { fakeWindow, windowListeners };
}

class WorkingPerformanceObserver {
  observe() {}
  disconnect() {}
}

describe('main-world bridge hardening', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('registers the bridge even when observer startup throws', async () => {
    class ThrowingPerformanceObserver {
      constructor() {
        throw new Error('resource observation unavailable');
      }
    }
    const { fakeWindow } = installPageGlobals(
      ThrowingPerformanceObserver as unknown as typeof PerformanceObserver,
    );

    await expect(import('./main-world')).resolves.toBeDefined();
    expect(fakeWindow.addEventListener).toHaveBeenCalledWith('message', expect.any(Function));
  });

  it('ignores an overlong request ID', async () => {
    const { fakeWindow, windowListeners } = installPageGlobals(
      WorkingPerformanceObserver as unknown as typeof PerformanceObserver,
    );
    await import('./main-world');

    windowListeners.get('message')?.({
      source: fakeWindow,
      data: {
        source: 'youtubook-cs',
        cmd: 'GET_TIMEDTEXT_URL',
        reqId: 'x'.repeat(129),
        payload: { videoId: 'video-1' },
      },
    } as unknown as MessageEvent);

    expect(fakeWindow.postMessage).not.toHaveBeenCalled();
  });

  it('replies null immediately to a malformed wait payload', async () => {
    const { fakeWindow, windowListeners } = installPageGlobals(
      WorkingPerformanceObserver as unknown as typeof PerformanceObserver,
    );
    await import('./main-world');

    windowListeners.get('message')?.({
      source: fakeWindow,
      data: {
        source: 'youtubook-cs',
        cmd: 'WAIT_FOR_TIMEDTEXT_URL',
        reqId: 'yb-1',
        payload: { videoId: 'video-1', afterStartTime: Number.POSITIVE_INFINITY },
      },
    } as unknown as MessageEvent);

    expect(fakeWindow.postMessage).toHaveBeenCalledOnce();
    expect(fakeWindow.postMessage).toHaveBeenCalledWith({
      source: 'youtubook-bridge',
      reqId: 'yb-1',
      payload: null,
    }, '*');
  });

  it('accepts cancellation without replying and rejects malformed cancellation', async () => {
    vi.useFakeTimers();
    const { fakeWindow, windowListeners } = installPageGlobals(
      WorkingPerformanceObserver as unknown as typeof PerformanceObserver,
    );
    await import('./main-world');
    const onMessage = windowListeners.get('message');

    onMessage?.({
      source: fakeWindow,
      data: {
        source: 'youtubook-cs',
        cmd: 'WAIT_FOR_TIMEDTEXT_URL',
        reqId: 'yb-wait-1',
        payload: { videoId: 'video-1' },
      },
    } as unknown as MessageEvent);
    onMessage?.({
      source: fakeWindow,
      data: {
        source: 'youtubook-cs',
        cmd: 'CANCEL_TIMEDTEXT_WAIT',
        reqId: 'yb-wait-1',
      },
    } as unknown as MessageEvent);
    onMessage?.({
      source: fakeWindow,
      data: {
        source: 'youtubook-cs',
        cmd: 'CANCEL_TIMEDTEXT_WAIT',
        reqId: 'yb-wait-1',
        payload: true,
      },
    } as unknown as MessageEvent);

    await vi.advanceTimersByTimeAsync(6_000);

    expect(fakeWindow.postMessage).not.toHaveBeenCalled();
  });
});
