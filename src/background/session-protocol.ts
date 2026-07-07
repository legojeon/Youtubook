import { repKey } from '../core/types';
import { applyThumbChunk, validateThumbChunk } from '../core/thumb-chunks';
import type { Msg, MsgResponse } from '../messages';
import {
  deletePendingSession,
  finalizePendingSession,
  getPendingSession,
  getSession,
  putPendingFrameAtomic,
  resetPendingSession,
  updatePendingSession,
  updateSession,
  validatePendingFrameBudget,
} from '../storage/db';
import { commitPendingSession } from './session-commit';
import { canonicalizeSessionBegin, isYoutubeWatchUrl, validateId } from './session-validation';

// Abandoned extraction data is removed on the next SESSION_BEGIN after 24 hours.
export const PENDING_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

interface ProtocolStorage {
  deletePendingSession: typeof deletePendingSession;
  finalizePendingSession: typeof finalizePendingSession;
  getPendingSession: typeof getPendingSession;
  getSession: typeof getSession;
  putPendingFrameAtomic: typeof putPendingFrameAtomic;
  resetPendingSession: typeof resetPendingSession;
  updatePendingSession: typeof updatePendingSession;
  updateSession: typeof updateSession;
}

export interface BackgroundMessageDeps {
  now: () => number;
  resultsUrl: string;
  openOrFocusResults: (sessionId: string) => Promise<void>;
  broadcast: (message: Msg) => Promise<void>;
  sendToTab: (tabId: number, message: Msg) => Promise<MsgResponse>;
  storage?: Partial<ProtocolStorage>;
}

const defaultStorage: ProtocolStorage = {
  deletePendingSession,
  finalizePendingSession,
  getPendingSession,
  getSession,
  putPendingFrameAtomic,
  resetPendingSession,
  updatePendingSession,
  updateSession,
};

export function validateTopLevelYoutubeSender(
  sender: chrome.runtime.MessageSender,
  expectedVideoId?: string,
): number {
  const tabId = sender.tab?.id;
  if (!Number.isSafeInteger(tabId) || (tabId as number) < 0) {
    throw new Error('A valid sender tab is required.');
  }
  if (sender.frameId !== 0) throw new Error('Message must come from the top-level frame.');
  // YouTube is a SPA: after an in-page (pushState) navigation the content script's
  // committed frame URL (sender.url) can lag behind the address bar, while the tab
  // URL (sender.tab.url) tracks the live /watch URL. Accept either — both describe
  // the already-verified top frame (frameId === 0 above), so neither is spoofable.
  const watchUrl = isYoutubeWatchUrl(sender.url)
    ? sender.url
    : isYoutubeWatchUrl(sender.tab?.url)
      ? sender.tab?.url
      : undefined;
  if (watchUrl === undefined) {
    throw new Error('Message must come from an https://www.youtube.com/watch page.');
  }
  if (expectedVideoId !== undefined
    && new URL(watchUrl).searchParams.get('v') !== expectedVideoId) {
    throw new Error('Sender URL does not match the session video.');
  }
  return tabId as number;
}

export function validateResultsSender(
  sender: chrome.runtime.MessageSender,
  resultsUrl: string,
): void {
  if (sender.frameId !== 0) throw new Error('Message must come from the top-level results frame.');
  if (typeof sender.url !== 'string') throw new Error('Results page sender URL is required.');
  let actual: URL;
  let expected: URL;
  try {
    actual = new URL(sender.url);
    expected = new URL(resultsUrl);
  } catch {
    throw new Error('Results page sender URL is malformed.');
  }
  if (actual.protocol !== expected.protocol
    || actual.host !== expected.host
    || actual.pathname !== expected.pathname) {
    throw new Error('REQUEST_CAPTURES must come from the extension results page.');
  }
}

async function requirePending(
  storage: ProtocolStorage,
  sessionId: unknown,
  tabId: number,
) {
  validateId(sessionId, 'Session ID');
  const pending = await storage.getPendingSession(sessionId);
  if (!pending) throw new Error('조립 중인 세션이 없습니다.');
  if (pending.meta.id !== sessionId) throw new Error('Session ID does not match pending data.');
  if (pending.meta.tabId !== tabId) throw new Error('Sender tab does not own this session.');
  return pending;
}

export function createSessionMessageHandler(deps: BackgroundMessageDeps) {
  const storage: ProtocolStorage = { ...defaultStorage, ...deps.storage };

  return async (
    msg: Msg,
    sender: chrome.runtime.MessageSender,
  ): Promise<MsgResponse> => {
    try {
      switch (msg.type) {
        case 'SESSION_BEGIN': {
          const tabId = validateTopLevelYoutubeSender(sender, msg.meta.videoId);
          const canonical = canonicalizeSessionBegin(msg, tabId);
          const now = deps.now();
          await storage.resetPendingSession({
            ...canonical,
            thumbs: [],
            updatedAt: now,
          }, Math.max(0, now - PENDING_SESSION_TTL_MS));
          return { ok: true };
        }

        case 'SESSION_THUMBS_CHUNK': {
          const tabId = validateTopLevelYoutubeSender(sender);
          const pending = await requirePending(storage, msg.sessionId, tabId);
          validateTopLevelYoutubeSender(sender, pending.meta.videoId);
          validateThumbChunk(msg.startIndex, msg.thumbs, pending.scores.length);
          const updated = await storage.updatePendingSession(msg.sessionId, current => {
            if (current.meta.tabId !== tabId) throw new Error('Sender tab does not own this session.');
            const thumbs = [...current.thumbs];
            applyThumbChunk(thumbs, msg.startIndex, msg.thumbs);
            return { ...current, thumbs, updatedAt: deps.now() };
          });
          if (!updated) throw new Error('조립 중인 세션이 없습니다.');
          return { ok: true };
        }

        case 'SESSION_IMAGE': {
          const tabId = validateTopLevelYoutubeSender(sender);
          validateId(msg.sessionId, 'Session ID');
          const pending = await requirePending(storage, msg.sessionId, tabId);
          validateTopLevelYoutubeSender(sender, pending.meta.videoId);
          await storage.putPendingFrameAtomic(
            msg.sessionId,
            tabId,
            msg.key,
            msg.dataUrl,
            deps.now(),
          );
          return { ok: true };
        }

        case 'SESSION_COMMIT': {
          const tabId = validateTopLevelYoutubeSender(sender);
          validateId(msg.sessionId, 'Session ID');
          const owned = await storage.getPendingSession(msg.sessionId)
            ?? await storage.getSession(msg.sessionId);
          if (!owned) throw new Error('조립 중인 세션이 없습니다.');
          if (owned.meta.tabId !== tabId) throw new Error('Sender tab does not own this session.');
          validateTopLevelYoutubeSender(sender, owned.meta.videoId);
          return await commitPendingSession(msg.sessionId, {
            finalizePendingSession: sessionId =>
              storage.finalizePendingSession(sessionId, tabId, 5),
            openOrFocusResults: deps.openOrFocusResults,
            deletePendingSession: storage.deletePendingSession,
          });
        }

        case 'REQUEST_CAPTURES': {
          validateResultsSender(sender, deps.resultsUrl);
          validateId(msg.sessionId, 'Session ID');
          const session = await storage.getSession(msg.sessionId);
          if (!session) return { ok: false, reason: '세션을 찾을 수 없습니다.' };
          try {
            return await deps.sendToTab(session.meta.tabId, {
              type: 'CAPTURE_FRAMES',
              sessionId: msg.sessionId,
              videoId: session.meta.videoId,
              reps: msg.reps,
            });
          } catch {
            return { ok: false, reason: 'tab-closed' };
          }
        }

        case 'FRAME_UPLOAD': {
          const tabId = validateTopLevelYoutubeSender(sender);
          validateId(msg.sessionId, 'Session ID');
          const updated = await storage.updateSession(msg.sessionId, current => {
            if (current.meta.tabId !== tabId) {
              throw new Error('Sender tab does not own this session.');
            }
            validateTopLevelYoutubeSender(sender, current.meta.videoId);
            if (typeof msg.key !== 'string'
              || !current.ranges.some(range => repKey(range.repSec) === msg.key)) {
              throw new Error('Frame key is not expected for this session.');
            }
            const existingChars = Object.entries(current.images).reduce(
              (sum, [key, dataUrl]) => sum + (key === msg.key ? 0 : dataUrl.length),
              0,
            );
            validatePendingFrameBudget(msg.dataUrl, existingChars);
            return {
              ...current,
              images: { ...current.images, [msg.key]: msg.dataUrl },
            };
          });
          if (!updated) return { ok: false, reason: '세션을 찾을 수 없습니다.' };
          await deps.broadcast({
            type: 'FRAME_ACCEPTED',
            sessionId: msg.sessionId,
            key: msg.key,
            dataUrl: msg.dataUrl,
          }).catch(() => {});
          return { ok: true };
        }

        default:
          return { ok: false, reason: 'unknown message' };
      }
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
  };
}
