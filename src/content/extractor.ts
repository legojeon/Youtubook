import { frameDiffScore } from '../core/diff';
import type { RepRef } from '../messages';

export function buildSampleTimes(durationSec: number, intervalSec: number): number[] {
  const times: number[] = [];
  for (let t = 0; t < durationSec; t += intervalSec) times.push(t);
  return times.length ? times : [0];
}

function aborted(): DOMException {
  return new DOMException('사용자가 취소했습니다', 'AbortError');
}

/** 백그라운드 탭에서 rAF가 멎어도 진행되도록 타임아웃과 경쟁시킨다. */
function nextFrame(): Promise<void> {
  return new Promise(resolve => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    requestAnimationFrame(() => finish());
    setTimeout(finish, 250);
  });
}

async function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  const target = Math.min(Math.max(t, 0), Math.max(0, video.duration - 0.1));
  if (Math.abs(video.currentTime - target) < 0.01) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`seek 시간 초과 (${target.toFixed(1)}s)`));
    }, 5000);
    const onSeeked = () => { cleanup(); resolve(); };
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener('seeked', onSeeked);
    };
    video.addEventListener('seeked', onSeeked);
    video.currentTime = target;
  });
  await nextFrame();
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas 2d context 생성 실패');
  return [cv, ctx];
}

export interface ScanResult {
  scores: number[];
  thumbs: string[];
}

export async function scanVideo(
  video: HTMLVideoElement,
  intervalSec: number,
  onProgress: (done: number, total: number) => void,
  signal: AbortSignal,
): Promise<ScanResult> {
  const times = buildSampleTimes(video.duration, intervalSec);
  const aspect = video.videoHeight / video.videoWidth || 9 / 16;
  const thumbW = 160;
  const thumbH = Math.max(2, Math.round(thumbW * aspect));
  const diffW = 64;
  const diffH = Math.max(1, Math.round(diffW * aspect));
  const [thumbCv, thumbCtx] = makeCanvas(thumbW, thumbH);
  const [, diffCtx] = makeCanvas(diffW, diffH);

  const scores: number[] = [];
  const thumbs: string[] = [];
  let prev: ImageData | null = null;
  for (let i = 0; i < times.length; i++) {
    if (signal.aborted) throw aborted();
    await seekTo(video, times[i]);
    thumbCtx.drawImage(video, 0, 0, thumbW, thumbH);
    diffCtx.drawImage(thumbCv, 0, 0, diffW, diffH);
    const cur = diffCtx.getImageData(0, 0, diffW, diffH); // 오염 시 SecurityError 전파
    scores.push(prev ? frameDiffScore(prev, cur) : 0);
    thumbs.push(thumbCv.toDataURL('image/jpeg', 0.6));
    prev = cur;
    onProgress(i + 1, times.length);
  }
  return { scores, thumbs };
}

export async function captureFrames(
  video: HTMLVideoElement,
  reps: RepRef[],
  onProgress: (done: number, total: number) => void,
  onFrame: (key: string, dataUrl: string) => Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  const [, ctx] = makeCanvas(video.videoWidth, video.videoHeight);
  for (let i = 0; i < reps.length; i++) {
    if (signal.aborted) throw aborted();
    await seekTo(video, reps[i].repSec);
    ctx.drawImage(video, 0, 0);
    await onFrame(reps[i].key, ctx.canvas.toDataURL('image/jpeg', 0.9));
    onProgress(i + 1, reps.length);
  }
}

export interface PlayerState {
  currentTime: number;
  paused: boolean;
  muted: boolean;
}

export function savePlayerState(v: HTMLVideoElement): PlayerState {
  return { currentTime: v.currentTime, paused: v.paused, muted: v.muted };
}

export async function restorePlayerState(v: HTMLVideoElement, s: PlayerState): Promise<void> {
  await seekTo(v, s.currentTime).catch(() => {});
  v.muted = s.muted;
  if (!s.paused) await v.play().catch(() => {});
}

export async function waitForNoAd(onWaiting: () => void, signal: AbortSignal): Promise<void> {
  const player = document.getElementById('movie_player');
  while (
    player?.classList.contains('ad-showing') ||
    player?.classList.contains('ad-interrupting')
  ) {
    if (signal.aborted) throw aborted();
    onWaiting();
    await new Promise(r => setTimeout(r, 500));
  }
}
