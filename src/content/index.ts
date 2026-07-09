import { DEFAULT_DETECT } from '../core/detect';
import { repKey, type SessionMeta } from '../core/types';
import type { Msg, MsgResponse } from '../messages';
import { getPlayerInfo } from './bridge-client';
import {
  captureFrames, restorePlayerState, savePlayerState, waitForNoAd, type AdUi,
} from './extractor';
import {
  extractionDurationError,
  prepareCaptionedScan,
  scanMetaFields,
} from './extraction-orchestration';
import { createOverlay } from './overlay';
import { createProgressReporter } from './progress-reporter';
import { runRecapture } from './recapture';
import { sendSessionImage, sendSessionStart } from './session-sender';
import { t } from '../ui/i18n';

let running = false;
let currentAbort: (() => void) | null = null;

chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse: (r: MsgResponse) => void) => {
  if (typeof msg !== 'object' || msg === null || typeof (msg as { type?: unknown }).type !== 'string') {
    return false;
  }
  const message = msg as Msg;
  if (message.type === 'START_EXTRACTION') {
    if (running) {
      sendResponse({ ok: false, reason: '이미 추출이 진행 중입니다.' });
      return false;
    }
    sendResponse({ ok: true });
    void runExtraction();
    return false;
  }
  if (message.type === 'CAPTURE_FRAMES') {
    runRecapture(message, {
      findVideo,
      currentVideoId: () => new URLSearchParams(location.search).get('v'),
      isRunning: () => running,
      setRunning: value => { running = value; },
      addNavigateListener: listener => document.addEventListener('yt-navigate-start', listener),
      removeNavigateListener: listener => document.removeEventListener('yt-navigate-start', listener),
      savePlayerState,
      restorePlayerState: (video, state) =>
        restorePlayerState(video, state as ReturnType<typeof savePlayerState>),
      waitForNoAd,
      captureFrames,
      send,
    }).then(sendResponse);
    return true; // 비동기 응답
  }
  if (message.type === 'CANCEL_EXTRACTION') {
    currentAbort?.();
    sendResponse({ ok: true });
    return false;
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
  currentAbort = () => ac.abort();
  // If the tab navigates to another video mid-run (e.g. YouTube autoplay after the video ends),
  // the session is invalid — treat it as a quiet cancel, not a scary error. A frame upload can
  // race the abort and be rejected by the SW ('Sender URL does not match'); the flag makes the
  // catch below treat that as cancelled too.
  let navigated = false;
  const onNavigate = () => { navigated = true; ac.abort(); };
  document.addEventListener('yt-navigate-start', onNavigate);
  // The definitive check: compare the live ?v= to the one we started on. This catches a video
  // change even when yt-navigate-start didn't fire (or a frame upload raced it), so a stray
  // 'Sender URL does not match' rejection never surfaces as an error.
  const startVideoId = new URLSearchParams(location.search).get('v');
  const videoChanged = () => new URLSearchParams(location.search).get('v') !== startVideoId;
  const overlay = createOverlay(() => ac.abort());
  // fire-and-forget: progress sends have no responder, so swallow the promise.
  const reporter = createProgressReporter(m => { void send(m).catch(() => {}); });
  let stageKey = 'overlay_preparing';
  const setStage = (key: string) => {
    stageKey = key;
    overlay.setStage(t(key));
    reporter.report(0, key, true); // stage change -> immediate report
  };
  const onProgress = (done: number, total: number) => {
    overlay.setProgress(done, total);
    reporter.report(total ? (done / total) * 100 : 0, stageKey);
  };
  const ad: AdUi = {
    onWait: waiting => overlay.setStage(t(waiting ? 'stage_adsWaiting' : stageKey)),
    onStuck: () => { void send({ type: 'AD_STUCK' }).catch(() => {}); },
  };
  const video = findVideo();
  try {
    if (!location.pathname.startsWith('/watch') || !video) {
      throw new Error(t('popup_notYoutube'));
    }
    const info = await getPlayerInfo().catch((err: unknown) => {
      console.warn('[youtubook] 브리지 호출 실패 — 자막 없이 진행합니다', err);
      return null;
    });
    const durationError = extractionDurationError(info?.isLive ?? false, video.duration);
    if (durationError) throw new Error(t(durationError));

    setStage('stage_ads');
    await waitForNoAd(() => setStage('stage_adsWaiting'), ac.signal);

    const state = savePlayerState(video);
    video.muted = true;
    video.pause();

    let result;
    try {
      const {
        videoId,
        captions,
        sampleIntervalSec,
        scan,
        detection: det,
      } = await prepareCaptionedScan({
        video,
        info,
        urlVideoId: new URLSearchParams(location.search).get('v'),
        onProgress,
        onStage: key => setStage(key),
        signal: ac.signal,
        ad,
        getVideo: findVideo,
      });

      const meta: SessionMeta = {
        id: crypto.randomUUID(),
        videoId,
        title: info?.title ?? document.title.replace(/ - YouTube$/, ''),
        videoUrl: location.href,
        tabId: -1,
        durationSec: video.duration,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        ...scanMetaFields(captions, sampleIntervalSec),
        sensitivity: DEFAULT_DETECT.sensitivity,
        truncated: det.truncated,
        createdAt: Date.now(),
      };
      await sendSessionStart(send, {
        type: 'SESSION_BEGIN',
        meta,
        scores: scan.scores,
        cues: captions.cues,
        ranges: det.ranges,
      }, scan.thumbs);

      setStage('stage_capture');
      // Capture at the quality that's already loaded — don't force the player to the max
      // (e.g. 4K). A quality switch resets the media source, and on a flaky network the new
      // segments may never load (readyState stuck at HAVE_METADATA), stalling every capture
      // seek into a low-res scan-thumbnail fallback. capture resolution is capped in captureFrames.
      await captureFrames(
        video,
        det.ranges.map(r => ({ key: repKey(r.repSec), repSec: r.repSec })),
        (d, total) => onProgress(d, total),
        async (key, dataUrl) => { await sendSessionImage(send, meta.id, key, dataUrl); },
        ac.signal,
        ad,
        findVideo,
      );
      result = await send({ type: 'SESSION_COMMIT', sessionId: meta.id });
    } finally {
      // Restore the CURRENT element — a mid-roll ad may have swapped it mid-run.
      await restorePlayerState(findVideo() ?? video, state, ac.signal);
    }
    if (!result?.ok) throw new Error(result?.reason ?? t('banner_saveFail'));
    overlay.remove();
    // Success: the SW commit path marks done (badge ✓ + notification). No ENDED needed.
  } catch (err) {
    // A navigation away counts as cancelled — the session's video is gone, so any error it
    // produced (AbortError, or a 'Sender URL does not match' rejection that raced the abort)
    // shouldn't surface as a failure. Check both the event flag and the live ?v=.
    const cancelled = navigated || videoChanged() || (err instanceof DOMException && err.name === 'AbortError');
    if (cancelled) {
      overlay.remove();
    } else if (err instanceof DOMException && err.name === 'SecurityError') {
      overlay.showError(t('overlay_errorProtected'));
    } else {
      overlay.showError(err instanceof Error ? err.message : t('overlay_errorGeneric'));
    }
    send({ type: 'EXTRACTION_ENDED', reason: cancelled ? 'cancelled' : 'error' }).catch(() => {});
  } finally {
    document.removeEventListener('yt-navigate-start', onNavigate);
    currentAbort = null;
    running = false;
  }
}
