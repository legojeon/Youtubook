// MAIN 월드에서 실행 — 유튜브 플레이어 내부 API 접근 담당.
// 콘텐츠 스크립트와는 window.postMessage로만 통신한다.
import { MAX_TIMEDTEXT_URLS_PER_VIDEO } from '../core/limits';
import { TimedtextUrlCache, type TimedtextQuery } from '../core/timedtext';
import { observeResourceUrls } from './timedtext-observer';
import { TimedtextWaiterMap } from './timedtext-waiters';

interface YtPlayerEl extends HTMLElement {
  getPlayerResponse?: () => unknown;
  getAvailableQualityLevels?: () => string[];
  setPlaybackQualityRange?: (min: string, max: string) => void;
}

interface RawTrack {
  baseUrl?: string;
  languageCode?: string;
  kind?: string;
  name?: { simpleText?: string; runs?: { text?: string }[] };
}

const timedtextUrls = new TimedtextUrlCache(MAX_TIMEDTEXT_URLS_PER_VIDEO);
const pendingTimedtextWaiters = new TimedtextWaiterMap(timedtextUrls);

if (typeof PerformanceObserver !== 'undefined') {
  observeResourceUrls((name, startTime) => {
    if (timedtextUrls.add(name, startTime)) {
      pendingTimedtextWaiters.resolveMatches();
    }
  });
}

document.addEventListener('yt-navigate-start', () => {
  timedtextUrls.clear();
  pendingTimedtextWaiters.clear();
});

window.addEventListener('message', (ev: MessageEvent) => {
  const d = ev.data as {
    source?: string;
    cmd?: string;
    reqId?: string;
    payload?: unknown;
  } | null;
  if (ev.source !== window || !d || d.source !== 'youtubook-cs' || !d.reqId) return;

  const reply = (payload: unknown) =>
    window.postMessage({ source: 'youtubook-bridge', reqId: d.reqId, payload }, '*');
  const player = document.getElementById('movie_player') as YtPlayerEl | null;

  if (d.cmd === 'GET_TIMEDTEXT_URL' || d.cmd === 'WAIT_FOR_TIMEDTEXT_URL') {
    const query = d.payload as TimedtextQuery | undefined;
    if (!query || typeof query.videoId !== 'string') {
      reply(null);
    } else if (d.cmd === 'GET_TIMEDTEXT_URL') {
      reply(timedtextUrls.find(query));
    } else {
      pendingTimedtextWaiters.wait(query, reply);
    }
  } else if (d.cmd === 'GET_PLAYER_INFO') {
    const pr = (player?.getPlayerResponse?.() ??
      (window as unknown as { ytInitialPlayerResponse?: unknown }).ytInitialPlayerResponse) as {
      videoDetails?: { videoId?: string; title?: string; isLive?: boolean };
      captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: RawTrack[] } };
    } | null;
    const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    reply({
      videoId: pr?.videoDetails?.videoId ?? null,
      title: pr?.videoDetails?.title ?? document.title.replace(/ - YouTube$/, ''),
      isLive: !!pr?.videoDetails?.isLive,
      captionTracks: tracks
        .filter(t => t.baseUrl && t.languageCode)
        .map(t => ({
          baseUrl: t.baseUrl!,
          languageCode: t.languageCode!,
          kind: t.kind,
          label: t.name?.simpleText ?? t.name?.runs?.[0]?.text,
        })),
    });
  } else if (d.cmd === 'SET_MAX_QUALITY') {
    try {
      const levels = player?.getAvailableQualityLevels?.() ?? [];
      if (levels[0]) player?.setPlaybackQualityRange?.(levels[0], levels[0]);
      reply({ ok: true });
    } catch {
      reply({ ok: false }); // 화질 설정 실패는 치명적이지 않음 — 현재 화질로 캡처
    }
  }
});
