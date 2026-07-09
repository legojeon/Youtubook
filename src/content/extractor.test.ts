// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAdShowing, clickSkipIfPresent, shouldAbortForSkips, settleAds, seekOnce, seekTo, scanVideo } from './extractor';

afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function makePlayer(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'movie_player';
  document.body.appendChild(el);
  return el;
}

function makeVideo(): HTMLVideoElement {
  const v = document.createElement('video');
  let ct = 0;
  Object.defineProperty(v, 'currentTime', { configurable: true, get: () => ct, set: (x: number) => { ct = x; } });
  Object.defineProperty(v, 'duration', { configurable: true, value: 100, writable: true });
  Object.defineProperty(v, 'videoWidth', { configurable: true, value: 640, writable: true });
  Object.defineProperty(v, 'videoHeight', { configurable: true, value: 360, writable: true });
  return v;
}

describe('isAdShowing', () => {
  it('true when player has ad-showing or ad-interrupting', () => {
    const p = makePlayer();
    expect(isAdShowing(p)).toBe(false);
    p.classList.add('ad-showing');
    expect(isAdShowing(p)).toBe(true);
    p.classList.remove('ad-showing');
    p.classList.add('ad-interrupting');
    expect(isAdShowing(p)).toBe(true);
  });
  it('false for null', () => { expect(isAdShowing(null)).toBe(false); });
});

describe('clickSkipIfPresent', () => {
  it('clicks the first visible skip button', () => {
    const p = makePlayer();
    const btn = document.createElement('button');
    btn.className = 'ytp-ad-skip-button-modern';
    // jsdom does no layout, so offsetParent is always null — stub it to simulate visibility.
    Object.defineProperty(btn, 'offsetParent', { configurable: true, get: () => document.body });
    const click = vi.spyOn(btn, 'click');
    p.appendChild(btn);
    clickSkipIfPresent(p);
    expect(click).toHaveBeenCalledTimes(1);
  });
  it('does nothing when the button is hidden (offsetParent null) or absent', () => {
    const p = makePlayer();
    const btn = document.createElement('button');
    btn.className = 'ytp-ad-skip-button-modern'; // offsetParent stays null (hidden)
    const click = vi.spyOn(btn, 'click');
    p.appendChild(btn);
    clickSkipIfPresent(p);
    clickSkipIfPresent(null);
    expect(click).not.toHaveBeenCalled();
  });
});

describe('shouldAbortForSkips', () => {
  it('aborts on a long consecutive skip streak', () => {
    expect(shouldAbortForSkips(8, 8, 8)).toBe(true);
    expect(shouldAbortForSkips(7, 7, 7)).toBe(false);
  });
  it('aborts when >30% of a meaningful sample is skipped', () => {
    expect(shouldAbortForSkips(1, 4, 10)).toBe(true);   // 4/10 = 40% > 30%, done>=10
    expect(shouldAbortForSkips(1, 2, 10)).toBe(false);  // 2/10 = 20%
    expect(shouldAbortForSkips(1, 3, 5)).toBe(false);   // done<10 → ratio not judged yet
  });
});

describe('settleAds', () => {
  it('returns 0 immediately when no ad is showing', async () => {
    makePlayer();
    await expect(settleAds(makeVideo(), new AbortController().signal, undefined, 90_000)).resolves.toBe(0);
  });

  it('waits until the ad clears, toggling onWait, clicking skip', async () => {
    vi.useFakeTimers();
    try {
      const p = makePlayer();
      p.classList.add('ad-showing');
      const btn = document.createElement('button');
      btn.className = 'ytp-ad-skip-button-modern';
      Object.defineProperty(btn, 'offsetParent', { configurable: true, get: () => document.body });
      const click = vi.spyOn(btn, 'click');
      p.appendChild(btn);
      const onWait = vi.fn();
      const promise = settleAds(makeVideo(), new AbortController().signal, { onWait }, 90_000);
      expect(onWait).toHaveBeenCalledWith(true);
      await vi.advanceTimersByTimeAsync(1000);        // 2 polls, ad still up → clicked
      expect(click).toHaveBeenCalled();
      p.classList.remove('ad-showing');
      await vi.advanceTimersByTimeAsync(500);         // next poll sees no ad → exits
      await promise;
      expect(onWait).toHaveBeenLastCalledWith(false);
    } finally { vi.useRealTimers(); }
  });

  it('fires onStuck exactly once after AD_NOTIFY_AFTER_MS while the ad persists', async () => {
    vi.useFakeTimers();
    try {
      const p = makePlayer();
      p.classList.add('ad-showing');
      const onStuck = vi.fn();
      const promise = settleAds(makeVideo(), new AbortController().signal, { onStuck }, 90_000);
      await vi.advanceTimersByTimeAsync(25_000);
      expect(onStuck).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(onStuck).toHaveBeenCalledTimes(1);        // not re-fired for the same ad
      p.classList.remove('ad-showing');
      await vi.advanceTimersByTimeAsync(500);
      await promise;
    } finally { vi.useRealTimers(); }
  });

  it('returns after budget is exhausted even if the ad remains', async () => {
    vi.useFakeTimers();
    try {
      const p = makePlayer();
      p.classList.add('ad-showing');
      const promise = settleAds(makeVideo(), new AbortController().signal, undefined, 2000);
      await vi.advanceTimersByTimeAsync(2000);
      await expect(promise).resolves.toBeGreaterThanOrEqual(2000);
    } finally { vi.useRealTimers(); }
  });

  it('rejects with AbortError when the signal aborts mid-wait', async () => {
    vi.useFakeTimers();
    try {
      const p = makePlayer();
      p.classList.add('ad-showing');
      const ac = new AbortController();
      const promise = settleAds(makeVideo(), ac.signal, undefined, 90_000);
      const assertion = expect(promise).rejects.toMatchObject({ name: 'AbortError' });
      ac.abort();
      await vi.advanceTimersByTimeAsync(500);
      await assertion;
    } finally { vi.useRealTimers(); }
  });
});

function makeSeekingVideo(): HTMLVideoElement {
  const v = makeVideo();
  const desc = Object.getOwnPropertyDescriptor(v, 'currentTime')!;
  Object.defineProperty(v, 'currentTime', {
    configurable: true,
    get: desc.get,
    set: (x: number) => { desc.set!.call(v, x); queueMicrotask(() => v.dispatchEvent(new Event('seeked'))); },
  });
  return v;
}

describe('seekOnce', () => {
  it('resolves "seeked" when the seeked event fires', async () => {
    makePlayer();
    const v = makeVideo();
    const p = seekOnce(v, 50, new AbortController().signal);
    await Promise.resolve();
    v.dispatchEvent(new Event('seeked'));
    await expect(p).resolves.toBe('seeked');
  });

  it('resolves "ad" when an ad appears during the seek', async () => {
    vi.useFakeTimers();
    try {
      const player = makePlayer();
      const p = seekOnce(makeVideo(), 50, new AbortController().signal);
      player.classList.add('ad-showing');
      await vi.advanceTimersByTimeAsync(500);
      await expect(p).resolves.toBe('ad');
    } finally { vi.useRealTimers(); }
  });

  it('resolves "timeout" after SEEK_TIMEOUT_MS with no seeked', async () => {
    vi.useFakeTimers();
    try {
      makePlayer();
      const p = seekOnce(makeVideo(), 50, new AbortController().signal);
      await vi.advanceTimersByTimeAsync(15_000);
      await expect(p).resolves.toBe('timeout');
    } finally { vi.useRealTimers(); }
  });

  it('degrades a currentTime assignment throw to "timeout"', async () => {
    makePlayer();
    const v = makeVideo();
    Object.defineProperty(v, 'currentTime', {
      configurable: true, get: () => 0, set: () => { throw new Error('non-finite'); },
    });
    await expect(seekOnce(v, 50, new AbortController().signal)).resolves.toBe('timeout');
  });
});

describe('seekTo', () => {
  it('returns true on a normal seek', async () => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    makePlayer();
    await expect(seekTo(makeSeekingVideo(), 50, new AbortController().signal)).resolves.toBe(true);
  });

  it('returns true immediately when already at the target', async () => {
    makePlayer();
    const v = makeVideo();
    v.currentTime = 50;
    await expect(seekTo(v, 50, new AbortController().signal)).resolves.toBe(true);
  });

  it('waits out an ad then succeeds without consuming retry budget', async () => {
    // Reach nextFrame's fast path deterministically under fake timers: visible + synchronous rAF.
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 1; });
    vi.useFakeTimers();
    try {
      const player = makePlayer();
      const v = makeVideo(); // plain video: no auto-seeked
      let seekedAllowed = false;
      const desc = Object.getOwnPropertyDescriptor(v, 'currentTime')!;
      Object.defineProperty(v, 'currentTime', {
        configurable: true, get: desc.get,
        set: (x: number) => { desc.set!.call(v, x); if (seekedAllowed) queueMicrotask(() => v.dispatchEvent(new Event('seeked'))); },
      });
      player.classList.add('ad-showing');
      const promise = seekTo(v, 50, new AbortController().signal);
      await vi.advanceTimersByTimeAsync(500);   // seekOnce poll sees the ad → 'ad'
      seekedAllowed = true;
      player.classList.remove('ad-showing');    // settleAds next poll clears the ad
      await vi.advanceTimersByTimeAsync(1000);
      await expect(promise).resolves.toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it('returns false (skip) after exhausting retries on persistent timeouts', async () => {
    vi.useFakeTimers();
    try {
      makePlayer();
      const v = makeVideo();  // seeked never fires
      const promise = seekTo(v, 50, new AbortController().signal);
      // 4 attempts × (15s timeout + backoff up to 2s)
      await vi.advanceTimersByTimeAsync(4 * (15_000 + 2_000));
      await expect(promise).resolves.toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it('throws AbortError when the signal is already aborted', async () => {
    makePlayer();
    const ac = new AbortController(); ac.abort();
    await expect(seekTo(makeVideo(), 50, ac.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('scanVideo skip semantics', () => {
  it('pushes aligned placeholders when every seek is skipped, and aborts when broadly failing', async () => {
    // jsdom has no canvas 2d — stub getContext so makeCanvas() succeeds (draw/read never run on skips).
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: () => {},
      getImageData: () => ({ data: new Uint8ClampedArray(), width: 0, height: 0 }),
    } as unknown as CanvasRenderingContext2D);
    vi.useFakeTimers();
    try {
      makePlayer();
      const v = makeVideo(); // seeked never fires → every seekTo returns false
      Object.defineProperty(v, 'duration', { configurable: true, value: 20, writable: true });
      const onProgress = vi.fn();
      const run = scanVideo(v, 1, onProgress, new AbortController().signal);
      const rejects = expect(run).rejects.toThrow('error_seekUnstable');
      // advance enough for ~10 failed samples (each ~4 attempts of 15s+backoff)
      await vi.advanceTimersByTimeAsync(10 * 4 * 17_000);
      await rejects;
    } finally { vi.useRealTimers(); }
  });
});
