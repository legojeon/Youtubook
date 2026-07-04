import { describe, expect, it, vi } from 'vitest';
import type { Msg, MsgResponse } from '../messages';
import { sendSessionStart } from './session-sender';

const begin = {
  type: 'SESSION_BEGIN' as const,
  meta: {
    id: 'session', videoId: 'video', title: 'Video', videoUrl: 'https://example.test',
    tabId: -1, durationSec: 1, videoWidth: 1, videoHeight: 1,
    sampleIntervalSec: 1, sensitivity: 5, captionsAvailable: true,
    captionStatus: 'available' as const, truncated: false, createdAt: 1,
  },
  scores: [0],
  cues: [{ startSec: 0, endSec: 1, text: 'caption' }],
  ranges: [],
};

describe('sendSessionStart', () => {
  it('awaits and checks begin plus 100/100/5 thumbnail chunks sequentially', async () => {
    const thumbs = Array.from({ length: 205 }, (_, i) => `thumb-${i}`);
    const calls: Msg[] = [];
    const releases: Array<() => void> = [];
    const send = vi.fn((message: Msg) => {
      calls.push(message);
      return new Promise<MsgResponse>(resolve => releases.push(() => resolve({ ok: true })));
    });

    const pending = sendSessionStart(send, begin, thumbs);
    expect(calls.map(message => message.type)).toEqual(['SESSION_BEGIN']);

    for (let expectedCalls = 2; expectedCalls <= 4; expectedCalls++) {
      releases.shift()!();
      await Promise.resolve();
      expect(calls).toHaveLength(expectedCalls);
    }
    releases.shift()!();
    await expect(pending).resolves.toBeUndefined();

    const chunks = calls.filter(
      (message): message is Extract<Msg, { type: 'SESSION_THUMBS_CHUNK' }> =>
        message.type === 'SESSION_THUMBS_CHUNK',
    );
    expect(chunks.map(chunk => [chunk.startIndex, chunk.thumbs.length]))
      .toEqual([[0, 100], [100, 100], [200, 5]]);
  });

  it('stops before the third chunk when the middle chunk response fails', async () => {
    const thumbs = Array.from({ length: 205 }, (_, i) => `thumb-${i}`);
    let response = 0;
    const send = vi.fn(async (): Promise<MsgResponse> => {
      response++;
      return response === 3 ? { ok: false, reason: 'middle failed' } : { ok: true };
    });

    await expect(sendSessionStart(send, begin, thumbs)).rejects.toThrow('middle failed');
    expect(send).toHaveBeenCalledTimes(3); // begin + first + failed middle
  });

  it('does not send thumbnails when SESSION_BEGIN fails', async () => {
    const send = vi.fn(async () => ({ ok: false, reason: 'begin failed' }));

    await expect(sendSessionStart(send, begin, ['thumb'])).rejects.toThrow('begin failed');
    expect(send).toHaveBeenCalledTimes(1);
  });
});
