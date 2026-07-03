import type { CaptionTrackInfo } from '../core/captions';

export interface PlayerInfo {
  videoId: string | null;
  title: string;
  isLive: boolean;
  captionTracks: CaptionTrackInfo[];
}

let seq = 0;

function bridgeCall<T>(cmd: string, timeoutMs = 2000): Promise<T> {
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
    window.postMessage({ source: 'youtubook-cs', cmd, reqId }, '*');
  });
}

export const getPlayerInfo = () => bridgeCall<PlayerInfo>('GET_PLAYER_INFO');
export const setMaxQuality = () => bridgeCall<{ ok: boolean }>('SET_MAX_QUALITY');
