import { repKey, type SessionData } from '../core/types';
import { thumbsComplete } from '../core/thumb-chunks';
import type { MsgResponse } from '../messages';
import type { PendingSessionData } from '../storage/db';

export interface SessionCommitDeps {
  getPendingSession: (sessionId: string) => Promise<PendingSessionData | null>;
  getPendingFrames: (sessionId: string) => Promise<Record<string, string>>;
  saveSession: (session: SessionData) => Promise<void>;
  pruneSessions: (keep: number) => Promise<void>;
  openResults: (sessionId: string) => Promise<void>;
  deletePendingSession: (sessionId: string) => Promise<void>;
}

const committing = new Set<string>();

export async function commitPendingSession(
  sessionId: string,
  deps: SessionCommitDeps,
): Promise<MsgResponse> {
  if (committing.has(sessionId)) {
    return { ok: false, reason: '세션 저장이 이미 진행 중입니다.' };
  }

  committing.add(sessionId);
  try {
    const pending = await deps.getPendingSession(sessionId);
    if (!pending) return { ok: false, reason: '조립 중인 세션이 없습니다.' };
    if (!thumbsComplete(pending.thumbs, pending.scores.length)) {
      return { ok: false, reason: '썸네일 전송이 완료되지 않았습니다.' };
    }
    const images = await deps.getPendingFrames(sessionId);
    if (pending.ranges.some(range => !Object.hasOwn(images, repKey(range.repSec)))) {
      return { ok: false, reason: '장면 이미지 전송이 완료되지 않았습니다.' };
    }
    const { updatedAt: _updatedAt, ...withoutTimestamp } = pending;
    const session: SessionData = {
      ...withoutTimestamp,
      images,
    };
    await deps.saveSession(session);
    await deps.pruneSessions(5);
    await deps.openResults(session.meta.id);
    await deps.deletePendingSession(sessionId);
    return { ok: true };
  } finally {
    committing.delete(sessionId);
  }
}
