import { describe, expect, it } from 'vitest';
import type { SessionData } from '../core/types';
import { commitPendingSession, type SessionCommitDeps } from './session-commit';

function session(): SessionData {
  return {
    meta: {
      id: 'session-1', videoId: 'video-1', title: 'Video',
      videoUrl: 'https://www.youtube.com/watch?v=video-1', tabId: 7,
      durationSec: 1, videoWidth: 1920, videoHeight: 1080,
      sampleIntervalSec: 1, sensitivity: 5, captionsAvailable: false,
      truncated: false, createdAt: 1,
    },
    scores: [0], thumbs: ['thumb'], cues: [], ranges: [], images: {},
  };
}

function deps(overrides: Partial<SessionCommitDeps> = {}): SessionCommitDeps {
  return {
    finalizePendingSession: async () => session(),
    openOrFocusResults: async () => {},
    deletePendingSession: async () => {},
    ...overrides,
  };
}

describe('commitPendingSession', () => {
  it('does not open or clean up when durable finalization fails', async () => {
    let openCalls = 0;
    let deleteCalls = 0;

    await expect(commitPendingSession('session-1', deps({
      finalizePendingSession: async () => { throw new Error('incomplete'); },
      openOrFocusResults: async () => { openCalls++; },
      deletePendingSession: async () => { deleteCalls++; },
    }))).rejects.toThrow('incomplete');

    expect(openCalls).toBe(0);
    expect(deleteCalls).toBe(0);
  });

  it('retains pending data when opening results fails after durable finalization', async () => {
    let deleteCalls = 0;

    await expect(commitPendingSession('session-1', deps({
      openOrFocusResults: async () => { throw new Error('open failed'); },
      deletePendingSession: async () => { deleteCalls++; },
    }))).rejects.toThrow('open failed');

    expect(deleteCalls).toBe(0);
  });

  it('retries across the finalize/open crash boundary without duplicate cleanup', async () => {
    let finalizeCalls = 0;
    let openCalls = 0;
    let deleteCalls = 0;
    const shared = deps({
      finalizePendingSession: async () => { finalizeCalls++; return session(); },
      openOrFocusResults: async () => {
        openCalls++;
        if (openCalls === 1) throw new Error('worker stopped before open completed');
      },
      deletePendingSession: async () => { deleteCalls++; },
    });

    await expect(commitPendingSession('session-1', shared)).rejects.toThrow('worker stopped');
    await expect(commitPendingSession('session-1', shared)).resolves.toEqual({ ok: true });

    expect(finalizeCalls).toBe(2);
    expect(openCalls).toBe(2);
    expect(deleteCalls).toBe(1);
  });

  it('treats cleanup failure after durable finalize and open as success', async () => {
    const result = await commitPendingSession('session-1', deps({
      deletePendingSession: async () => { throw new Error('cleanup failed'); },
    }));

    expect(result).toEqual({ ok: true });
  });

  it('runs durable finalize, open-or-focus, then cleanup in order', async () => {
    const calls: string[] = [];

    const result = await commitPendingSession('session-1', deps({
      finalizePendingSession: async () => { calls.push('finalize'); return session(); },
      openOrFocusResults: async id => { expect(id).toBe('session-1'); calls.push('open'); },
      deletePendingSession: async id => { expect(id).toBe('session-1'); calls.push('delete'); },
    }));

    expect(result).toEqual({ ok: true });
    expect(calls).toEqual(['finalize', 'open', 'delete']);
  });

  it('rejects a concurrent in-worker commit without duplicating finalize or open', async () => {
    let releaseFinalize!: () => void;
    const gate = new Promise<void>(resolve => { releaseFinalize = resolve; });
    let entered!: () => void;
    const finalizeEntered = new Promise<void>(resolve => { entered = resolve; });
    let finalizeCalls = 0;
    let openCalls = 0;
    const shared = deps({
      finalizePendingSession: async () => {
        finalizeCalls++;
        entered();
        await gate;
        return session();
      },
      openOrFocusResults: async () => { openCalls++; },
    });

    const first = commitPendingSession('session-1', shared);
    await finalizeEntered;
    const second = await commitPendingSession('session-1', shared);
    releaseFinalize();

    expect(second.ok).toBe(false);
    expect(second.reason).toContain('진행 중');
    await expect(first).resolves.toEqual({ ok: true });
    expect(finalizeCalls).toBe(1);
    expect(openCalls).toBe(1);
  });
});
