import { frameContentScore } from '../core/diff';
import { MAX_SCAN_SAMPLES } from '../core/limits';
import type { RepRef } from '../messages';
import { t } from '../ui/i18n';

const NEVER_ABORT = new AbortController().signal;

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

export interface AdUi {
  onWait?: (waiting: boolean) => void;  // overlay "ad waiting" ↔ resume
  onStuck?: () => void;                 // once per ad episode after AD_NOTIFY_AFTER_MS
}

/** Abortable delay. Rejects with AbortError if the signal is/becomes aborted. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(aborted()); return; }
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', onAbort); };
    const onAbort = () => { cleanup(); reject(aborted()); };
    const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
    signal.addEventListener('abort', onAbort);
  });
}

/**
 * Wait out any ad, auto-clicking "Skip" each poll. Returns ms waited (0 if no ad).
 * `notified` is local, so onStuck fires at most once per ad episode (no poll spam);
 * settleAds is called once per ad, so multiple ads each get their own judgement.
 */
export async function settleAds(
  video: HTMLVideoElement,
  signal: AbortSignal,
  ad: AdUi | undefined,
  budgetMs: number,
): Promise<number> {
  const player = document.getElementById('movie_player');
  if (!isAdShowing(player) || budgetMs <= 0) return 0;
  ad?.onWait?.(true);
  let waited = 0;
  let notified = false;
  try {
    while (isAdShowing(player) && waited < budgetMs) {
      if (signal.aborted) throw aborted();
      clickSkipIfPresent(player);
      if (!notified && waited >= AD_NOTIFY_AFTER_MS) { ad?.onStuck?.(); notified = true; }
      await sleep(AD_POLL_MS, signal);
      waited += AD_POLL_MS;
    }
  } finally {
    ad?.onWait?.(false);
  }
  return waited;
}

type SeekOutcome = 'seeked' | 'ad' | 'timeout';

/** One seek attempt. Races the seeked event, ad appearance, and a timeout.
 *  Never rejects except on cancel; a currentTime assignment throw becomes 'timeout'. */
export function seekOnce(
  video: HTMLVideoElement,
  target: number,
  signal: AbortSignal,
): Promise<SeekOutcome> {
  return new Promise<SeekOutcome>((resolve, reject) => {
    const player = document.getElementById('movie_player');
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      clearInterval(poll);
      video.removeEventListener('seeked', onSeeked);
      signal.removeEventListener('abort', onAbort);
    };
    const finish = (outcome: SeekOutcome) => { if (!settled) { settled = true; cleanup(); resolve(outcome); } };
    const onSeeked = () => finish('seeked');
    const onAbort = () => { if (!settled) { settled = true; cleanup(); reject(aborted()); } };
    const timer = setTimeout(() => finish('timeout'), SEEK_TIMEOUT_MS);
    const poll = setInterval(() => { if (isAdShowing(player)) finish('ad'); }, AD_POLL_MS);
    video.addEventListener('seeked', onSeeked);
    signal.addEventListener('abort', onAbort);
    if (signal.aborted) { onAbort(); return; }
    try {
      video.currentTime = target;
    } catch {
      finish('timeout'); // non-finite / bad state — let the recovery loop handle it
    }
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

function backoff(attempt: number, signal: AbortSignal): Promise<void> {
  return sleep(Math.min(2000, 500 * 2 ** (attempt - 1)), signal); // 500, 1000, 2000, 2000
}

/**
 * Robust seek. Waits out ads (auto-skip), tolerates source resets, retries stalls,
 * and returns false (skip) instead of throwing — except on cancel (AbortError).
 * Ad waits do NOT consume the retry budget; only genuine timeouts do.
 */
export async function seekTo(
  video: HTMLVideoElement,
  t: number,
  signal: AbortSignal,
  ad?: AdUi,
): Promise<boolean> {
  let attempts = 0;
  let adWaited = 0;
  while (attempts < MAX_SEEK_ATTEMPTS) {
    if (signal.aborted) throw aborted();
    adWaited += await settleAds(video, signal, ad, AD_WAIT_BUDGET_MS - adWaited);
    if (adWaited >= AD_WAIT_BUDGET_MS && isAdShowing(document.getElementById('movie_player'))) {
      return false; // ad budget exhausted, still an ad → skip this frame
    }
    await waitForVideoReady(video, signal);
    const target = clampSeekTarget(t, video.duration);
    if (!Number.isFinite(target)) { attempts++; await backoff(attempts, signal); continue; }
    // Only trust "already there" before any attempt: a real HTMLMediaElement's currentTime
    // getter reflects the seek target as soon as it's assigned, well before 'seeked' confirms
    // a frame is actually ready — so after a timeout, position equality is not proof of success.
    if (attempts === 0 && Math.abs(video.currentTime - target) < 0.01) return true;
    const outcome = await seekOnce(video, target, signal);
    if (outcome === 'seeked') { await nextFrame(); return true; }
    if (outcome === 'ad') continue;        // loop top re-runs settleAds (no attempt consumed)
    attempts++;                            // 'timeout'
    await backoff(attempts, signal);
  }
  return false;
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

/** Wait for non-zero dimensions AND a finite duration (both drop during ad/quality resets).
 *  Best-effort: returns on timeout instead of throwing, so seekTo keeps recovering. */
export async function waitForVideoReady(
  video: { videoWidth: number; videoHeight: number; duration: number },
  signal: AbortSignal,
  deps: { nextFrame: () => Promise<void>; now: () => number } =
    { nextFrame, now: () => performance.now() },
  timeoutMs = DIMENSIONS_TIMEOUT_MS,
): Promise<void> {
  const start = deps.now();
  while (!video.videoWidth || !video.videoHeight || !Number.isFinite(video.duration)) {
    if (signal.aborted) throw aborted();
    if (deps.now() - start > timeoutMs) return;
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
  ad?: AdUi,
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
  let totalSkips = 0;
  let consecutiveSkips = 0;
  for (let i = 0; i < times.length; i++) {
    if (signal.aborted) throw aborted();
    const ok = await seekTo(video, times[i], signal, ad);
    if (ok) {
      thumbCtx.drawImage(video, 0, 0, thumbW, thumbH);
      diffCtx.drawImage(thumbCv, 0, 0, diffW, diffH);
      const cur = diffCtx.getImageData(0, 0, diffW, diffH); // 오염 시 SecurityError 전파
      scores.push(prev ? frameContentScore(prev, cur) : 0);
      thumbs.push(thumbCv.toDataURL('image/jpeg', 0.6));
      prev = cur;
      consecutiveSkips = 0;
    } else {
      // Preserve index↔time alignment: 0 score never forms a false cut; reuse the
      // last good thumbnail so the fallback preview isn't blank. prev is unchanged.
      scores.push(0);
      thumbs.push(thumbs.length ? thumbs[thumbs.length - 1] : '');
      totalSkips++;
      consecutiveSkips++;
      if (shouldAbortForSkips(consecutiveSkips, totalSkips, i + 1)) {
        throw new Error(t('error_seekUnstable'));
      }
    }
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
  ad?: AdUi,
): Promise<void> {
  await waitForVideoDimensions(video, signal);
  const [, ctx] = makeCanvas(video.videoWidth, video.videoHeight);
  for (let i = 0; i < reps.length; i++) {
    if (signal.aborted) throw aborted();
    const ok = await seekTo(video, reps[i].repSec, signal, ad);
    if (ok) {
      ctx.drawImage(video, 0, 0);
      await onFrame(reps[i].key, ctx.canvas.toDataURL('image/jpeg', 0.9));
    }
    // else: skip — imageFor() falls back to the scan thumbnail (book-data.ts:19)
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

export async function restorePlayerState(
  v: HTMLVideoElement, s: PlayerState, signal: AbortSignal = NEVER_ABORT,
): Promise<void> {
  v.playbackRate = s.playbackRate;
  await seekTo(v, s.currentTime, signal).catch(() => {});
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
