import { frameContentScore } from '../core/diff';
import { MAX_SCAN_SAMPLES } from '../core/limits';
import { createSampleBinner } from '../core/sample-binner';
import { makeCanvas, waitForNoAd, waitForVideoDimensions, type ScanResult } from './extractor';

// MediaStreamTrackProcessor / HTMLMediaElement.captureStream은 TS lib.dom에 없어 직접 타입을 준다.
// (VideoFrame은 lib.dom에 있고 CanvasImageSource에도 포함되므로 drawImage에 그대로 쓸 수 있다.)
type VideoCaptureElement = HTMLVideoElement & { captureStream(): MediaStream };
type TrackProcessorCtor = new (init: { track: MediaStreamTrack }) => {
  readable: ReadableStream<VideoFrame>;
};

const SCAN_PLAYBACK_RATE = 6;
const END_EPSILON_SEC = 0.5;    // 재생이 끝 근처에서 멈추므로 duration 직전을 '끝'으로 본다
const MAX_REACQUIRE = 8;        // 광고 등으로 트랙 재획득을 반복할 상한(무한 루프 방지)

/** captureStream + MediaStreamTrackProcessor 지원 여부(숨긴 탭 프레임 캡처의 전제). `in` 연산자로
 *  캐스트 없이 실제 존재를 확인한다(jsdom에는 둘 다 없어 false). */
export function canUseStreamCapture(): boolean {
  return typeof HTMLMediaElement !== 'undefined'
    && 'captureStream' in HTMLMediaElement.prototype
    && 'MediaStreamTrackProcessor' in globalThis;
}

function aborted(): DOMException {
  return new DOMException('사용자가 취소했습니다', 'AbortError');
}

/**
 * 재생-통과 스캔: video를 SCAN_PLAYBACK_RATE로 재생하며 captureStream이 전달하는 프레임을
 * 64px로 그려 색차를 계산하고, sample-binner로 sampleIntervalSec 격자 샘플({scores, thumbs})을
 * 만든다. 숨긴 탭에서도 동작한다(captureStream/MediaStreamTrackProcessor는 hidden에서 동결되지 않음).
 */
export async function scanVideoStream(
  video: HTMLVideoElement,
  sampleIntervalSec: number,
  onProgress: (done: number, total: number) => void,
  signal: AbortSignal,
): Promise<ScanResult> {
  await waitForVideoDimensions(video, signal);

  const duration = video.duration;
  const total = Number.isFinite(duration) && duration > 0
    ? Math.min(MAX_SCAN_SAMPLES, Math.ceil(duration / sampleIntervalSec))
    : MAX_SCAN_SAMPLES;

  const aspect = video.videoHeight / video.videoWidth || 9 / 16;
  const thumbW = 160;
  const thumbH = Math.max(2, Math.round(thumbW * aspect));
  const diffW = 64;
  const diffH = Math.max(1, Math.round(diffW * aspect));
  const [thumbCv, thumbCtx] = makeCanvas(thumbW, thumbH);
  const [, diffCtx] = makeCanvas(diffW, diffH);

  const binner = createSampleBinner(sampleIntervalSec);
  let prev: ImageData | null = null;

  const isEnd = () => video.ended
    || (Number.isFinite(duration) && video.currentTime >= duration - END_EPSILON_SEC);

  video.playbackRate = SCAN_PLAYBACK_RATE;
  try {
    video.currentTime = 0;
  } catch {
    // currentTime 설정 실패는 무시하고 진행(0 부근에서 시작)
  }

  let finished = false;
  const Processor = (globalThis as unknown as {
    MediaStreamTrackProcessor: TrackProcessorCtor;
  }).MediaStreamTrackProcessor;

  for (let attempt = 0; attempt < MAX_REACQUIRE && !finished; attempt++) {
    if (signal.aborted) throw aborted();

    const stream = (video as VideoCaptureElement).captureStream();
    const track = stream.getVideoTracks()[0];
    if (!track) break; // 캡처 불가 → 폴백에 맡긴다
    const reader = new Processor({ track }).readable.getReader();

    // 파이프라인 준비 후 재생(첫 프레임을 미디어시간 0 부근에서 잡아 정렬 보존)
    await video.play().catch(() => {});

    try {
      for (;;) {
        const result = await reader.read();
        if (result.done) break; // 트랙 종료(영상 끝 또는 광고/소스 교체)
        const frame = result.value; // done=false로 판별되어 VideoFrame으로 좁혀진다
        if (signal.aborted) { frame.close(); throw aborted(); }

        const t = video.currentTime;
        thumbCtx.drawImage(frame, 0, 0, thumbW, thumbH);
        diffCtx.drawImage(thumbCv, 0, 0, diffW, diffH);
        const cur = diffCtx.getImageData(0, 0, diffW, diffH); // 오염 시 SecurityError 전파
        const score = prev ? frameContentScore(prev, cur) : 0;
        binner.push(t, score, thumbCv.toDataURL('image/jpeg', 0.6));
        prev = cur;
        onProgress(Math.min(binner.scores.length, total), total);
        frame.close();

        if (isEnd()) { finished = true; break; }
        if (video.paused && !finished) await video.play().catch(() => {});
        if (binner.scores.length >= MAX_SCAN_SAMPLES) { finished = true; break; }
      }
    } finally {
      reader.releaseLock();
      track.stop();
    }

    if (finished || isEnd()) break;
    // 트랙이 끝났는데 영상 끝이 아니면 광고/중단 → 광고 종료 대기 후 재획득
    await waitForNoAd(() => { /* 진행 표시는 상위 오버레이가 담당 */ }, signal);
  }

  binner.finish();
  return { scores: binner.scores, thumbs: binner.thumbs };
}
