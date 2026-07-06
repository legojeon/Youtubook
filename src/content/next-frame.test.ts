// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextFrame } from './extractor';

afterEach(() => { vi.unstubAllGlobals(); });

describe('nextFrame', () => {
  it('resolves via MessageChannel when hidden, even if rAF never fires', async () => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    // Simulate a frozen background tab: rAF callback is never invoked.
    vi.stubGlobal('requestAnimationFrame', () => 0);
    await expect(nextFrame()).resolves.toBeUndefined();
  });

  it('resolves via rAF when visible', async () => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 1; });
    await expect(nextFrame()).resolves.toBeUndefined();
  });
});
