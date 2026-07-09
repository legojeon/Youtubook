import { frameContentScore } from '../core/diff';
import { MAX_SCAN_SAMPLES } from '../core/limits';
import type { RepRef } from '../messages';

export function buildSampleTimes(durationSec: number, intervalSec: number): number[] {
  const times: number[] = [];
  for (let i = 0; i < MAX_SCAN_SAMPLES; i++) {
    const t = i * intervalSec;
    if (t >= durationSec) break;
    times.push(t);
  }
  return times.length ? times : [0];
}

function aborted(): DOMException {
  return new DOMException('사용자가 취소했습니다', 'AbortError');
}

/**
 * seeked 직후의 settle. 보이는 탭은 rAF 페인트를 기다린다(기존 동작). 숨긴 탭은 rAF가
 * 동결되고 setTimeout이 ~1s로 클램프되므로, 클램프를 받지 않는 MessageChannel yield로
 * 즉시 진행한다(캡처 정확성은 seeked 이벤트가 보장 — 설계 §2에서 실측).
 */
export function nextFrame(): Promise<void> {
  if (document.hidden) {
    return new Promise(resolve => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => resolve();
      ch.port2.postMessage(0);
    });
  }
  return new Promise(resolve => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    requestAnimationFrame(() => finish());
    setTimeout(finish, 250);
  });
}

// 세그먼트 로딩이 느린 지점(영상 끝부분, 세그먼트 경계)에서 seeked가 수 초 늦게 오는
// 스파이크가 실측됨(480p·빠른 회선에서도 ~4s) — 여유 있는 타임아웃 + 1회 재시도로 흡수한다.
const SEEK_TIMEOUT_MS = 15_000;

const MAX_SEEK_ATTEMPTS = 4;
const AD_POLL_MS = 500;
const AD_WAIT_BUDGET_MS = 90_000;
const AD_NOTIFY_AFTER_MS = 25_000;
const SKIP_ABORT_STREAK = 8;
const SKIP_ABORT_RATIO = 0.3;
// YouTube renames the skip button across UI revisions — try a set; a stale selector
// degrades to passive wait + the 25s notification fallback, never a crash.
const SKIP_SELECTORS = [
  '.ytp-ad-skip-button-modern',
  '.ytp-ad-skip-button',
  '.ytp-skip-ad-button',
];

/** True while YouTube is showing/entering an ad (mid-roll included). */
export function isAdShowing(player: Element | null): boolean {
  return !!player && (
    player.classList.contains('ad-showing') ||
    player.classList.contains('ad-interrupting')
  );
}

/** Click the first VISIBLE "Skip" button, if any. Best-effort — no-op otherwise. */
export function clickSkipIfPresent(player: Element | null): void {
  if (!player) return;
  for (const sel of SKIP_SELECTORS) {
    const btn = player.querySelector<HTMLElement>(sel);
    if (btn && btn.offsetParent !== null) { btn.click(); return; }
  }
}

/** Bail out of a scan only when seeks are broadly failing, not on a stray skip. */
export function shouldAbortForSkips(
  consecutiveSkips: number, totalSkips: number, done: number,
): boolean {
  if (consecutiveSkips >= SKIP_ABORT_STREAK) return true;
  if (done >= 10 && totalSkips / done > SKIP_ABORT_RATIO) return true;
  return false;
}

function seekOnce(video: HTMLVideoElement, target: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`seek 시간 초과 (${target.toFixed(1)}s)`));
    }, SEEK_TIMEOUT_MS);
    const onSeeked = () => { cleanup(); resolve(); };
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener('seeked', onSeeked);
    };
    video.addEventListener('seeked', onSeeked);
    video.currentTime = target;
  });
}

/**
 * Clamp a requested seek time to a safe finite value. `video.duration` can be
 * NaN during a mid-roll ad; without this guard `Math.min(t, NaN)` yields NaN,
 * and `video.currentTime = NaN` throws and aborts the whole extraction.
 */
export function clampSeekTarget(t: number, duration: number): number {
  if (!Number.isFinite(t)) return NaN;
  const upper = Number.isFinite(duration) ? Math.max(0, duration - 0.1) : Math.max(0, t);
  return Math.min(Math.max(t, 0), upper);
}

async function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  const target = clampSeekTarget(t, video.duration);
  if (!Number.isFinite(target)) return; // bad/NaN target — skip instead of throwing
  if (Math.abs(video.currentTime - target) < 0.01) return;
  const started = performance.now();
  try {
    await seekOnce(video, target);
  } catch (err) {
    console.warn('[youtubook] seek 재시도', target, err);
    await seekOnce(video, target);
  }
  const elapsed = performance.now() - started;
  if (elapsed > 3000) {
    console.warn(`[youtubook] 느린 seek: ${target.toFixed(1)}s (${Math.round(elapsed)}ms)`);
  }
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

export const DIMENSIONS_TIMEOUT_MS = 15_000;

/**
 * Wait for the video to report non-zero dimensions. `setMaxQuality` (and mid-roll
 * ads) reset the media source, so `videoWidth`/`videoHeight` briefly drop to 0 —
 * a one-shot check would abort capture. Polls until they return or the timeout.
 */
export async function waitForVideoDimensions(
  video: { videoWidth: number; videoHeight: number },
  signal: AbortSignal,
  deps: { nextFrame: () => Promise<void>; now: () => number } =
    { nextFrame, now: () => performance.now() },
  timeoutMs = DIMENSIONS_TIMEOUT_MS,
): Promise<void> {
  const start = deps.now();
  while (!video.videoWidth || !video.videoHeight) {
    if (signal.aborted) throw aborted();
    if (deps.now() - start > timeoutMs) {
      throw new Error('영상 크기를 확인할 수 없습니다 — 영상이 로드된 후 다시 시도해주세요.');
    }
    await deps.nextFrame();
  }
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
  await waitForVideoDimensions(video, signal);
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
    scores.push(prev ? frameContentScore(prev, cur) : 0);
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
  await waitForVideoDimensions(video, signal);
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
  playbackRate: number;
}

export function savePlayerState(v: HTMLVideoElement): PlayerState {
  return { currentTime: v.currentTime, paused: v.paused, muted: v.muted, playbackRate: v.playbackRate };
}

export async function restorePlayerState(v: HTMLVideoElement, s: PlayerState): Promise<void> {
  v.playbackRate = s.playbackRate;
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
