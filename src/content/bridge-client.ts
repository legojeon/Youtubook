import type { CaptionTrackInfo } from '../core/captions';
import type { ObservedTimedtextUrl, TimedtextQuery } from '../core/timedtext';

export interface PlayerInfo {
  videoId: string | null;
  title: string;
  isLive: boolean;
  captionTracks: CaptionTrackInfo[];
}

let seq = 0;

function bridgeCall<T>(cmd: string, payload?: unknown, timeoutMs = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const reqId = `yb-${++seq}`;
    const timer = setTimeout(() => {
      cleanup();
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
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener('message', onMsg);
    };
    window.addEventListener('message', onMsg);
    window.postMessage({ source: 'youtubook-cs', cmd, reqId, payload }, '*');
  });
}

export const getPlayerInfo = () => bridgeCall<PlayerInfo>('GET_PLAYER_INFO');
export const setMaxQuality = () => bridgeCall<{ ok: boolean }>('SET_MAX_QUALITY');
export const getTimedtextUrl = (query: TimedtextQuery) =>
  bridgeCall<ObservedTimedtextUrl | null>('GET_TIMEDTEXT_URL', query);
export const waitForTimedtextUrl = (query: TimedtextQuery) =>
  bridgeCall<ObservedTimedtextUrl | null>('WAIT_FOR_TIMEDTEXT_URL', query, 7_000);
