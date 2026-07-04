import type { SessionData } from '../core/types';
import { applyThumbChunk, validateThumbChunk } from '../core/thumb-chunks';
import { validateScanScores } from '../core/limits';
import type { Msg, MsgResponse } from '../messages';
import { getSession, pruneSessions, saveSession, updateSession } from '../storage/db';
import { commitPendingSession } from './session-commit';

// 탭별 조립 중 세션 (전송 중에는 메시지가 SW를 깨어있게 유지한다)
const pending = new Map<number, SessionData>();

const HANDLED = new Set<Msg['type']>([
  'SESSION_BEGIN', 'SESSION_THUMBS_CHUNK', 'SESSION_IMAGE', 'SESSION_COMMIT',
  'REQUEST_CAPTURES', 'FRAME_READY',
]);

chrome.runtime.onMessage.addListener(
  (msg: Msg, sender, sendResponse: (r: MsgResponse) => void) => {
    if (!HANDLED.has(msg.type)) return false;
    handle(msg, sender)
      .then(sendResponse)
      .catch(err => sendResponse({ ok: false, reason: err instanceof Error ? err.message : String(err) }));
    return true;
  },
);

async function handle(msg: Msg, sender: chrome.runtime.MessageSender): Promise<MsgResponse> {
  const tabId = sender.tab?.id ?? -1;
  switch (msg.type) {
    case 'SESSION_BEGIN':
      validateScanScores(msg.scores);
      pending.set(tabId, {
        meta: { ...msg.meta, tabId },
        scores: msg.scores,
        cues: msg.cues,
        ranges: msg.ranges,
        thumbs: [],
        images: {},
      });
      return { ok: true };

    case 'SESSION_THUMBS_CHUNK': {
      const s = pending.get(tabId);
      if (!s) return { ok: false, reason: '조립 중인 세션이 없습니다.' };
      validateThumbChunk(msg.startIndex, msg.thumbs, s.scores.length);
      applyThumbChunk(s.thumbs, msg.startIndex, msg.thumbs);
      return { ok: true };
    }

    case 'SESSION_IMAGE': {
      const s = pending.get(tabId);
      if (!s) return { ok: false, reason: '조립 중인 세션이 없습니다.' };
      s.images[msg.key] = msg.dataUrl;
      return { ok: true };
    }

    case 'SESSION_COMMIT':
      return commitPendingSession(pending, tabId, {
        saveSession,
        pruneSessions,
        openResults: async sessionId => {
          await chrome.tabs.create({
            url: chrome.runtime.getURL(`src/results/results.html?session=${sessionId}`),
          });
        },
      });

    case 'REQUEST_CAPTURES': {
      const session = await getSession(msg.sessionId);
      if (!session) return { ok: false, reason: '세션을 찾을 수 없습니다.' };
      try {
        return await chrome.tabs.sendMessage<Msg, MsgResponse>(session.meta.tabId, {
          type: 'CAPTURE_FRAMES',
          sessionId: msg.sessionId,
          videoId: session.meta.videoId,
          reps: msg.reps,
        });
      } catch {
        return { ok: false, reason: 'tab-closed' };
      }
    }

    case 'FRAME_READY':
      await updateSession(msg.sessionId, s => ({
        ...s,
        images: { ...s.images, [msg.key]: msg.dataUrl },
      }));
      return { ok: true };

    default:
      return { ok: false, reason: 'unknown message' };
  }
}
