import { DEFAULT_DETECT, detectScenes } from '../core/detect';
import { repKey, type SessionMeta } from '../core/types';
import type { Msg, MsgResponse } from '../messages';
import { getPlayerInfo, setMaxQuality } from './bridge-client';
import { fetchCaptions } from './captions-fetch';
import {
  captureFrames, restorePlayerState, savePlayerState, scanVideo, waitForNoAd,
} from './extractor';
import { createOverlay } from './overlay';

let running = false;

chrome.runtime.onMessage.addListener((msg: Msg, _sender, sendResponse: (r: MsgResponse) => void) => {
  if (msg.type === 'START_EXTRACTION') {
    if (running) {
      sendResponse({ ok: false, reason: '이미 추출이 진행 중입니다.' });
      return false;
    }
    sendResponse({ ok: true });
    void runExtraction();
    return false;
  }
  if (msg.type === 'CAPTURE_FRAMES') {
    runRecapture(msg).then(sendResponse);
    return true; // 비동기 응답
  }
  return false;
});

function findVideo(): HTMLVideoElement | null {
  return document.querySelector<HTMLVideoElement>('#movie_player video');
}

const send = (m: Msg) => chrome.runtime.sendMessage<Msg, MsgResponse>(m);

async function runExtraction(): Promise<void> {
  running = true;
  const ac = new AbortController();
  const overlay = createOverlay(() => ac.abort());
  const video = findVideo();
  try {
    if (!location.pathname.startsWith('/watch') || !video) {
      throw new Error('유튜브 영상 페이지에서 실행해주세요.');
    }
    const info = await getPlayerInfo().catch(() => null); // 브리지 실패 → 자막 없이 진행 (폴백)
    if (info?.isLive || !isFinite(video.duration) || video.duration <= 0) {
      throw new Error('라이브/프리미어 영상은 지원하지 않습니다.');
    }

    overlay.setStage('광고 확인 중…');
    await waitForNoAd(() => overlay.setStage('광고가 끝나면 시작합니다…'), ac.signal);
    await setMaxQuality().catch(() => {});

    const state = savePlayerState(video);
    video.muted = true;
    video.pause();

    let result;
    try {
      overlay.setStage('장면 스캔 중…');
      const scan = await scanVideo(video, DEFAULT_DETECT.sampleIntervalSec,
        (d, t) => overlay.setProgress(d, t), ac.signal);

      const det = detectScenes(scan.scores, { ...DEFAULT_DETECT, durationSec: video.duration });

      overlay.setStage('자막 추출 중…');
      const cues = info ? await fetchCaptions(info.captionTracks) : null;

      const meta: SessionMeta = {
        id: crypto.randomUUID(),
        videoId: info?.videoId ?? new URLSearchParams(location.search).get('v') ?? 'unknown',
        title: info?.title ?? document.title.replace(/ - YouTube$/, ''),
        videoUrl: location.href,
        tabId: -1, // SW가 sender.tab.id로 채움
        durationSec: video.duration,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        sampleIntervalSec: DEFAULT_DETECT.sampleIntervalSec,
        sensitivity: DEFAULT_DETECT.sensitivity,
        captionsAvailable: !!cues,
        truncated: det.truncated,
        createdAt: Date.now(),
      };
      await send({ type: 'SESSION_BEGIN', meta, scores: scan.scores, cues: cues ?? [], ranges: det.ranges });
      await send({ type: 'SESSION_THUMBS', thumbs: scan.thumbs });

      overlay.setStage('장면 캡처 중…');
      await captureFrames(
        video,
        det.ranges.map(r => ({ key: repKey(r.repSec), repSec: r.repSec })),
        (d, t) => overlay.setProgress(d, t),
        async (key, dataUrl) => { await send({ type: 'SESSION_IMAGE', key, dataUrl }); },
        ac.signal,
      );
      result = await send({ type: 'SESSION_COMMIT' });
    } finally {
      await restorePlayerState(video, state);
    }
    if (!result?.ok) throw new Error(result?.reason ?? '세션 저장에 실패했습니다.');
    overlay.remove();
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      overlay.remove();
    } else if (err instanceof DOMException && err.name === 'SecurityError') {
      overlay.showError('보호된 영상이라 캡처할 수 없습니다.');
    } else {
      overlay.showError(err instanceof Error ? err.message : '추출에 실패했습니다.');
    }
  } finally {
    running = false;
  }
}

async function runRecapture(
  msg: Extract<Msg, { type: 'CAPTURE_FRAMES' }>,
): Promise<MsgResponse> {
  const video = findVideo();
  const currentId = new URLSearchParams(location.search).get('v');
  if (!video || currentId !== msg.videoId) return { ok: false, reason: 'wrong-video' };
  if (running) return { ok: false, reason: '추출이 진행 중입니다.' };
  running = true;
  const ac = new AbortController();
  const state = savePlayerState(video);
  video.muted = true;
  video.pause();
  try {
    await waitForNoAd(() => {}, ac.signal);
    await captureFrames(
      video, msg.reps, () => {},
      async (key, dataUrl) => {
        await send({ type: 'FRAME_READY', sessionId: msg.sessionId, key, dataUrl });
      },
      ac.signal,
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : '재캡처 실패' };
  } finally {
    await restorePlayerState(video, state);
    running = false;
  }
}
