import { describe, expect, it } from 'vitest';
import type { SessionData } from '../core/types';
import type { PendingSessionData } from '../storage/db';
import { commitPendingSession, type SessionCommitDeps } from './session-commit';

function makeSession(thumbs = ['thumb-0'], id = 'session-1'): SessionData {
  return {
    meta: {
      id,
      videoId: 'video-1',
      title: 'Video',
      videoUrl: 'https://www.youtube.com/watch?v=video-1',
      tabId: 7,
      durationSec: 1,
      videoWidth: 1920,
      videoHeight: 1080,
      sampleIntervalSec: 1,
      sensitivity: 5,
      captionsAvailable: false,
      truncated: false,
      createdAt: 1,
    },
    scores: [0],
    thumbs,
    cues: [],
    ranges: [],
    images: {},
  };
}

function makePending(thumbs = ['thumb-0'], id = 'session-1'): PendingSessionData {
  const { images: _images, ...pending } = makeSession(thumbs, id);
  return { ...pending, updatedAt: 1 };
}

function deps(overrides: Partial<SessionCommitDeps> = {}): SessionCommitDeps {
  const pending = makePending();
  return {
    getPendingSession: async () => pending,
    getPendingFrames: async () => ({ '0.50': 'data:image/jpeg;base64,AAAA' }),
    saveSession: async () => {},
    pruneSessions: async () => {},
    openResults: async () => {},
    deletePendingSession: async () => {},
    ...overrides,
  };
}

describe('commitPendingSession', () => {
  it('rejects an incomplete persisted session without saving or removing it', async () => {
    const session = makePending([]);
    let saveCalls = 0;
    let deleteCalls = 0;

    const result = await commitPendingSession('session-1', deps({
      getPendingSession: async () => session,
      saveSession: async () => { saveCalls++; },
      deletePendingSession: async () => { deleteCalls++; },
    }));

    expect(result.ok).toBe(false);
    expect(saveCalls).toBe(0);
    expect(deleteCalls).toBe(0);
  });

  it('rejects a session with a missing expected frame', async () => {
    const pending = makePending();
    pending.ranges = [{ startSec: 0, endSec: 1, repSec: 0.5 }];
    let saveCalls = 0;

    const result = await commitPendingSession('session-1', deps({
      getPendingSession: async () => pending,
      getPendingFrames: async () => ({}),
      saveSession: async () => { saveCalls++; },
    }));

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('이미지');
    expect(saveCalls).toBe(0);
  });

  it('retains the pending session when saving fails', async () => {
    let deleteCalls = 0;

    await expect(commitPendingSession('session-1', deps({
      saveSession: async () => { throw new Error('save failed'); },
      deletePendingSession: async () => { deleteCalls++; },
    }))).rejects.toThrow('save failed');

    expect(deleteCalls).toBe(0);
  });

  it('retains the pending session when opening the results tab fails', async () => {
    let deleteCalls = 0;

    await expect(commitPendingSession('session-1', deps({
      openResults: async () => { throw new Error('open failed'); },
      deletePendingSession: async () => { deleteCalls++; },
    }))).rejects.toThrow('open failed');

    expect(deleteCalls).toBe(0);
  });

  it('reconstructs after a worker restart and deletes pending data only after save, prune, and open', async () => {
    const session = makePending();
    const calls: string[] = [];

    const result = await commitPendingSession('session-1', deps({
      getPendingSession: async () => session,
      getPendingFrames: async () => ({ '0.50': 'data:image/jpeg;base64,AAAA' }),
      saveSession: async saved => {
        expect(saved).toEqual({
          ...makeSession(),
          images: { '0.50': 'data:image/jpeg;base64,AAAA' },
        });
        calls.push('save');
      },
      pruneSessions: async keep => {
        expect(keep).toBe(5);
        calls.push('prune');
      },
      openResults: async sessionId => {
        expect(sessionId).toBe('session-1');
        calls.push('open');
      },
      deletePendingSession: async sessionId => {
        expect(sessionId).toBe('session-1');
        calls.push('delete');
      },
    }));

    expect(result).toEqual({ ok: true });
    expect(calls).toEqual(['save', 'prune', 'open', 'delete']);
  });

  it('rejects a concurrent commit without duplicating save or open', async () => {
    let releaseSave!: () => void;
    const saveGate = new Promise<void>(resolve => { releaseSave = resolve; });
    let signalSaveEntered!: () => void;
    const saveEntered = new Promise<void>(resolve => { signalSaveEntered = resolve; });
    let saveCalls = 0;
    let openCalls = 0;
    const sharedDeps = deps({
      saveSession: async () => {
        saveCalls++;
        signalSaveEntered();
        await saveGate;
      },
      openResults: async () => { openCalls++; },
    });

    const first = commitPendingSession('session-1', sharedDeps);
    await saveEntered;
    const secondPromise = commitPendingSession('session-1', sharedDeps);
    let secondWhileFirstPending: Awaited<ReturnType<typeof commitPendingSession>> | undefined;
    void secondPromise.then(result => { secondWhileFirstPending = result; });
    expect(saveCalls).toBe(1);
    expect(openCalls).toBe(0);
    releaseSave();
    await expect(first).resolves.toEqual({ ok: true });
    await secondPromise;
    expect(secondWhileFirstPending?.ok).toBe(false);
    expect(secondWhileFirstPending?.reason).toContain('진행 중');
    expect(openCalls).toBe(1);
  });

});
