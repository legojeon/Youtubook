import type { Msg, MsgResponse, RepRef } from '../messages';
import type { AdUi } from './extractor';

export interface RecaptureDeps {
  findVideo: () => HTMLVideoElement | null;
  currentVideoId: () => string | null;
  isRunning: () => boolean;
  setRunning: (running: boolean) => void;
  addNavigateListener: (listener: () => void) => void;
  removeNavigateListener: (listener: () => void) => void;
  savePlayerState: (video: HTMLVideoElement) => unknown;
  restorePlayerState: (video: HTMLVideoElement, state: unknown) => Promise<void>;
  waitForNoAd: (onWaiting: () => void, signal: AbortSignal) => Promise<void>;
  captureFrames: (
    video: HTMLVideoElement,
    reps: RepRef[],
    onProgress: (done: number, total: number) => void,
    onFrame: (key: string, dataUrl: string) => Promise<void>,
    signal: AbortSignal,
    ad?: AdUi,
  ) => Promise<void>;
  send: (message: Msg) => Promise<MsgResponse>;
}

export async function runRecapture(
  msg: Extract<Msg, { type: 'CAPTURE_FRAMES' }>,
  deps: RecaptureDeps,
): Promise<MsgResponse> {
  const video = deps.findVideo();
  if (!video || deps.currentVideoId() !== msg.videoId) {
    return { ok: false, reason: 'wrong-video' };
  }
  if (deps.isRunning()) return { ok: false, reason: '추출이 진행 중입니다.' };
  deps.setRunning(true);
  const ac = new AbortController();
  const onNavigate = () => ac.abort();
  deps.addNavigateListener(onNavigate);
  const state = deps.savePlayerState(video);
  video.muted = true;
  video.pause();
  try {
    await deps.waitForNoAd(() => {}, ac.signal);
    await deps.captureFrames(
      video,
      msg.reps,
      () => {},
      async (key, dataUrl) => {
        if (deps.currentVideoId() !== msg.videoId) {
          throw new DOMException('영상이 변경되었습니다', 'AbortError');
        }
        const response = await deps.send({
          type: 'FRAME_UPLOAD', sessionId: msg.sessionId, key, dataUrl,
        });
        if (!response.ok) throw new Error(response.reason ?? '재캡처 프레임 저장 실패');
      },
      ac.signal,
      { onStuck: () => { void deps.send({ type: 'AD_STUCK' }).catch(() => {}); } },
    );
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : '재캡처 실패' };
  } finally {
    deps.removeNavigateListener(onNavigate);
    await deps.restorePlayerState(video, state);
    deps.setRunning(false);
  }
}
