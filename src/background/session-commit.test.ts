import { describe, expect, it } from 'vitest';
import type { SessionData } from '../core/types';
import { commitPendingSession, type SessionCommitDeps } from './session-commit';

function makeSession(thumbs = ['thumb-0']): SessionData {
  return {
    meta: {
      id: 'session-1',
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

function deps(overrides: Partial<SessionCommitDeps> = {}): SessionCommitDeps {
  return {
    saveSession: async () => {},
    pruneSessions: async () => {},
    openResults: async () => {},
    ...overrides,
  };
}

describe('commitPendingSession', () => {
  it('rejects an incomplete session without saving or removing it', async () => {
    const session = makeSession([]);
    const pending = new Map([[7, session]]);
    let saveCalls = 0;

    const result = await commitPendingSession(pending, 7, deps({
      saveSession: async () => { saveCalls++; },
    }));

    expect(result.ok).toBe(false);
    expect(saveCalls).toBe(0);
    expect(pending.get(7)).toBe(session);
  });

  it('retains the pending session when saving fails', async () => {
    const session = makeSession();
    const pending = new Map([[7, session]]);

    await expect(commitPendingSession(pending, 7, deps({
      saveSession: async () => { throw new Error('save failed'); },
    }))).rejects.toThrow('save failed');

    expect(pending.get(7)).toBe(session);
  });

  it('retains the pending session when opening the results tab fails', async () => {
    const session = makeSession();
    const pending = new Map([[7, session]]);

    await expect(commitPendingSession(pending, 7, deps({
      openResults: async () => { throw new Error('open failed'); },
    }))).rejects.toThrow('open failed');

    expect(pending.get(7)).toBe(session);
  });

  it('removes the session only after saving, pruning, and opening results', async () => {
    const session = makeSession();
    const pending = new Map([[7, session]]);
    const calls: string[] = [];

    const result = await commitPendingSession(pending, 7, deps({
      saveSession: async saved => {
        expect(saved).toBe(session);
        calls.push('save');
      },
      pruneSessions: async keep => {
        expect(keep).toBe(5);
        calls.push('prune');
      },
      openResults: async sessionId => {
        expect(sessionId).toBe('session-1');
        expect(pending.has(7)).toBe(true);
        calls.push('open');
      },
    }));

    expect(result).toEqual({ ok: true });
    expect(calls).toEqual(['save', 'prune', 'open']);
    expect(pending.has(7)).toBe(false);
  });
});
