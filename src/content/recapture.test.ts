import { describe, expect, it, vi } from 'vitest';
import type { Msg } from '../messages';
import { runRecapture, type RecaptureDeps } from './recapture';

const msg: Extract<Msg, { type: 'CAPTURE_FRAMES' }> = {
  type: 'CAPTURE_FRAMES',
  sessionId: 'session-1',
  videoId: 'video-1',
  reps: [{ key: '0.50', repSec: 0.5 }],
};

function deps(overrides: Partial<RecaptureDeps> = {}): RecaptureDeps {
  const video = { muted: false, pause: vi.fn() } as unknown as HTMLVideoElement;
  return {
    findVideo: () => video,
    currentVideoId: () => 'video-1',
    isRunning: () => false,
    setRunning: () => {},
    addNavigateListener: () => {},
    removeNavigateListener: () => {},
    savePlayerState: () => ({}) as ReturnType<RecaptureDeps['savePlayerState']>,
    restorePlayerState: async () => {},
    waitForNoAd: async () => {},
    captureFrames: async (_video, _reps, _progress, onFrame) => {
      await onFrame('0.50', 'data:image/jpeg;base64,/9j/2Q==');
    },
    send: async () => ({ ok: true }),
    ...overrides,
  };
}

describe('runRecapture', () => {
  it('returns failure when the service worker rejects a frame upload', async () => {
    const send = vi.fn(async () => ({ ok: false, reason: 'rejected frame' }));

    const result = await runRecapture(msg, deps({ send }));

    expect(result).toEqual({ ok: false, reason: 'rejected frame' });
    expect(send).toHaveBeenCalledWith({
      type: 'FRAME_UPLOAD',
      sessionId: 'session-1',
      key: '0.50',
      dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
    });
  });

  it('passes an onStuck that posts AD_STUCK to the service worker', async () => {
    const send = vi.fn(async () => ({ ok: true }));
    const captureFrames = vi.fn(async (_v, _r, _p, _f, _s, ad) => { ad?.onStuck?.(); });
    await runRecapture(msg, deps({ send, captureFrames }));
    expect(send).toHaveBeenCalledWith({ type: 'AD_STUCK' });
  });
});
