import type { CaptionTrackInfo } from '../core/captions';
import type { ObservedTimedtextUrl, TimedtextQuery } from '../core/timedtext';

export interface PlayerInfo {
  videoId: string | null;
  title: string;
  isLive: boolean;
  captionTracks: CaptionTrackInfo[];
}

let seq = 0;

function aborted(): DOMException {
  return new DOMException('사용자가 취소했습니다', 'AbortError');
}

function bridgeCall<T>(
  cmd: string,
  payload?: unknown,
  timeoutMs = 2000,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(aborted());
      return;
    }
    const reqId = `yb-${++seq}`;
    const cancelTimedtextWait = () => {
      if (cmd !== 'WAIT_FOR_TIMEDTEXT_URL') return;
      try {
        window.postMessage({
          source: 'youtubook-cs',
          cmd: 'CANCEL_TIMEDTEXT_WAIT',
          reqId,
        }, '*');
      } catch {
        // Best effort: the MAIN-world waiter also has its own bounded timeout.
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      cancelTimedtextWait();
      reject(new Error(`bridge timeout: ${cmd}`));
    }, timeoutMs);
    const onMsg = (ev: MessageEvent) => {
      const d = ev.data as { source?: string; reqId?: string; payload?: T } | null;
      if (ev.source !== window || !d || d.source !== 'youtubook-bridge' || d.reqId !== reqId) return;
      cleanup();
      if (d.payload === undefined) {
        reject(new Error(`bridge empty payload: ${cmd}`));
        return;
      }
      resolve(d.payload as T);
    };
    const onAbort = () => {
      cleanup();
      cancelTimedtextWait();
      reject(aborted());
    };
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener('message', onMsg);
      signal?.removeEventListener('abort', onAbort);
    };
    window.addEventListener('message', onMsg);
    signal?.addEventListener('abort', onAbort, { once: true });
    window.postMessage({
      source: 'youtubook-cs',
      cmd,
      reqId,
      ...(payload === undefined ? {} : { payload }),
    }, '*');
  });
}

export const getPlayerInfo = () => bridgeCall<PlayerInfo>('GET_PLAYER_INFO');
export const setMaxQuality = () => bridgeCall<{ ok: boolean }>('SET_MAX_QUALITY');

export interface HoldResult {
  ok: boolean;
  prevAutonav: number | null;
}
// Pause via the player API and disable autoplay-to-next so extraction can't be interrupted
// by the tab navigating to another video. Returns the prior autoplay state to restore later.
export const holdPlayer = () => bridgeCall<HoldResult>('HOLD_PLAYER');
export const releasePlayer = (prevAutonav: number | null) =>
  bridgeCall<{ ok: boolean }>('RELEASE_PLAYER', { prevAutonav });
export const getTimedtextUrl = (query: TimedtextQuery, signal?: AbortSignal) =>
  bridgeCall<ObservedTimedtextUrl | null>('GET_TIMEDTEXT_URL', query, 2_000, signal);
export const waitForTimedtextUrl = (query: TimedtextQuery, signal?: AbortSignal) =>
  bridgeCall<ObservedTimedtextUrl | null>('WAIT_FOR_TIMEDTEXT_URL', query, 7_000, signal);
