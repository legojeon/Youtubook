// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAdShowing, clickSkipIfPresent, shouldAbortForSkips, settleAds } from './extractor';

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
