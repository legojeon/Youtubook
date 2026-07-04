import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_PENDING_TIMEDTEXT_WAITERS } from '../core/limits';
import { TimedtextUrlCache } from '../core/timedtext';
import { TimedtextWaiterMap } from './timedtext-waiters';

const timedtextUrl =
  'https://www.youtube.com/api/timedtext?v=video-1&lang=en&kind=asr&pot=proof';

describe('TimedtextWaiterMap', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('resolves a waiter when a duplicate URL is observed after its cutoff', () => {
    const cache = new TimedtextUrlCache(8);
    const waiters = new TimedtextWaiterMap(cache);
    const reply = vi.fn();
    cache.add(timedtextUrl, 1);

    waiters.wait({ videoId: 'video-1', languageCode: 'en', kind: 'asr', afterStartTime: 5 }, reply);
    cache.add(timedtextUrl, 9);
    waiters.resolveMatches();
    vi.advanceTimersByTime(6_000);

    expect(reply).toHaveBeenCalledOnce();
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ url: timedtextUrl, startTime: 9 }));
    expect(waiters.size).toBe(0);
  });

  it('returns a cached match immediately without leaving a timer', () => {
    const cache = new TimedtextUrlCache(8);
    const waiters = new TimedtextWaiterMap(cache);
    const reply = vi.fn();
    cache.add(timedtextUrl, 9);

    waiters.wait({ videoId: 'video-1' }, reply);
    vi.advanceTimersByTime(6_000);

    expect(reply).toHaveBeenCalledOnce();
    expect(reply.mock.calls[0][0]).toMatchObject({ startTime: 9 });
    expect(waiters.size).toBe(0);
  });

  it('times out once and ignores later matches', () => {
    const cache = new TimedtextUrlCache(8);
    const waiters = new TimedtextWaiterMap(cache);
    const reply = vi.fn();

    waiters.wait({ videoId: 'video-1' }, reply);
    vi.advanceTimersByTime(6_000);
    cache.add(timedtextUrl, 9);
    waiters.resolveMatches();

    expect(reply).toHaveBeenCalledOnce();
    expect(reply).toHaveBeenCalledWith(null);
    expect(waiters.size).toBe(0);
  });

  it('clears timers and replies null to every pending waiter on navigation', () => {
    const cache = new TimedtextUrlCache(8);
    const waiters = new TimedtextWaiterMap(cache);
    const firstReply = vi.fn();
    const secondReply = vi.fn();
    waiters.wait({ videoId: 'video-1' }, firstReply);
    waiters.wait({ videoId: 'video-2' }, secondReply);

    waiters.clear();
    vi.advanceTimersByTime(6_000);

    expect(firstReply).toHaveBeenCalledOnce();
    expect(firstReply).toHaveBeenCalledWith(null);
    expect(secondReply).toHaveBeenCalledOnce();
    expect(secondReply).toHaveBeenCalledWith(null);
    expect(waiters.size).toBe(0);
  });

  it('rejects new waiters immediately when the pending cap is reached', () => {
    const cache = new TimedtextUrlCache(8);
    const waiters = new TimedtextWaiterMap(cache);
    const overflowReply = vi.fn();

    for (let i = 0; i < MAX_PENDING_TIMEDTEXT_WAITERS; i++) {
      waiters.wait({ videoId: `video-${i}` }, vi.fn());
    }
    waiters.wait({ videoId: 'overflow-video' }, overflowReply);

    expect(overflowReply).toHaveBeenCalledOnce();
    expect(overflowReply).toHaveBeenCalledWith(null);
    expect(waiters.size).toBe(MAX_PENDING_TIMEDTEXT_WAITERS);
  });
});
