import { repKey } from '../core/types';
import { applyThumbChunk, validateThumbChunk } from '../core/thumb-chunks';
import type { Msg, MsgResponse } from '../messages';
import {
  createPendingSession,
  deletePendingSession,
  deletePendingSessionsOlderThan,
  getPendingFrames,
  getPendingSession,
  getSession,
  pruneSessions,
  putPendingFrame,
  saveSession,
  updatePendingSession,
  updateSession,
  validatePendingFrameBudget,
} from '../storage/db';
import { commitPendingSession } from './session-commit';
import { isYoutubeWatchUrl, validateId, validateSessionBegin } from './session-validation';

// Abandoned extraction data is removed on the next SESSION_BEGIN after 24 hours.
export const PENDING_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

interface ProtocolStorage {
  createPendingSession: typeof createPendingSession;
  deletePendingSession: typeof deletePendingSession;
  deletePendingSessionsOlderThan: typeof deletePendingSessionsOlderThan;
  getPendingFrames: typeof getPendingFrames;
  getPendingSession: typeof getPendingSession;
  getSession: typeof getSession;
  pruneSessions: typeof pruneSessions;
  putPendingFrame: typeof putPendingFrame;
  saveSession: typeof saveSession;
  updatePendingSession: typeof updatePendingSession;
  updateSession: typeof updateSession;
}

export interface BackgroundMessageDeps {
  now: () => number;
  resultsUrl: string;
  openResults: (sessionId: string) => Promise<void>;
  sendToTab: (tabId: number, message: Msg) => Promise<MsgResponse>;
  storage?: Partial<ProtocolStorage>;
}

const defaultStorage: ProtocolStorage = {
  createPendingSession,
  deletePendingSession,
  deletePendingSessionsOlderThan,
  getPendingFrames,
  getPendingSession,
  getSession,
  pruneSessions,
  putPendingFrame,
  saveSession,
  updatePendingSession,
  updateSession,
};

export function validateTopLevelYoutubeSender(
  sender: chrome.runtime.MessageSender,
): number {
  const tabId = sender.tab?.id;
  if (!Number.isSafeInteger(tabId) || (tabId as number) < 0) {
    throw new Error('A valid sender tab is required.');
  }
  if (sender.frameId !== 0) throw new Error('Message must come from the top-level frame.');
  if (!isYoutubeWatchUrl(sender.url)) {
    throw new Error('Message must come from an https://www.youtube.com/watch page.');
  }
  return tabId as number;
}

export function validateResultsSender(
  sender: chrome.runtime.MessageSender,
  resultsUrl: string,
): void {
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
          const tabId = validateTopLevelYoutubeSender(sender);
          validateSessionBegin(msg);
          const now = deps.now();
          await storage.deletePendingSessionsOlderThan(now - PENDING_SESSION_TTL_MS);
          await storage.deletePendingSession(msg.meta.id);
          await storage.createPendingSession({
            meta: { ...msg.meta, tabId },
            scores: msg.scores,
            cues: msg.cues,
            ranges: msg.ranges,
            thumbs: [],
            updatedAt: now,
          });
          return { ok: true };
        }

        case 'SESSION_THUMBS_CHUNK': {
          const tabId = validateTopLevelYoutubeSender(sender);
          const pending = await requirePending(storage, msg.sessionId, tabId);
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
          const pending = await requirePending(storage, msg.sessionId, tabId);
          if (typeof msg.key !== 'string'
            || !new Set(pending.ranges.map(range => repKey(range.repSec))).has(msg.key)) {
            throw new Error('Frame key is not expected for this session.');
          }
          await storage.putPendingFrame(msg.sessionId, msg.key, msg.dataUrl);
          await storage.updatePendingSession(msg.sessionId, current => ({
            ...current,
            updatedAt: deps.now(),
          }));
          return { ok: true };
        }

        case 'SESSION_COMMIT': {
          const tabId = validateTopLevelYoutubeSender(sender);
          await requirePending(storage, msg.sessionId, tabId);
          return await commitPendingSession(msg.sessionId, {
            getPendingSession: storage.getPendingSession,
            getPendingFrames: storage.getPendingFrames,
            saveSession: storage.saveSession,
            pruneSessions: storage.pruneSessions,
            openResults: deps.openResults,
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

        case 'FRAME_READY': {
          const tabId = validateTopLevelYoutubeSender(sender);
          validateId(msg.sessionId, 'Session ID');
          const updated = await storage.updateSession(msg.sessionId, current => {
            if (current.meta.tabId !== tabId) {
              throw new Error('Sender tab does not own this session.');
            }
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
