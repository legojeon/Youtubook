import type { SessionData } from '../core/types';
import { thumbsComplete } from '../core/thumb-chunks';
import type { MsgResponse } from '../messages';

export interface SessionCommitDeps {
  saveSession: (session: SessionData) => Promise<void>;
  pruneSessions: (keep: number) => Promise<void>;
  openResults: (sessionId: string) => Promise<void>;
}

export async function commitPendingSession(
  pending: Map<number, SessionData>,
  tabId: number,
  deps: SessionCommitDeps,
): Promise<MsgResponse> {
  const session = pending.get(tabId);
  if (!session) return { ok: false, reason: '조립 중인 세션이 없습니다.' };
  if (!thumbsComplete(session.thumbs, session.scores.length)) {
    return { ok: false, reason: '썸네일 전송이 완료되지 않았습니다.' };
  }

  await deps.saveSession(session);
  await deps.pruneSessions(5);
  await deps.openResults(session.meta.id);
  pending.delete(tabId);
  return { ok: true };
}
