import type { SessionData } from '../core/types';
import type { MsgResponse } from '../messages';

export interface SessionCommitDeps {
  finalizePendingSession: (sessionId: string) => Promise<SessionData>;
  openOrFocusResults: (sessionId: string) => Promise<void>;
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
    const session = await deps.finalizePendingSession(sessionId);
    await deps.openOrFocusResults(session.meta.id);
    await deps.deletePendingSession(sessionId).catch(() => {});
    return { ok: true };
  } finally {
    committing.delete(sessionId);
  }
}
