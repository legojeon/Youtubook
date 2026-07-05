import type { CaptionFetchResult, CaptionTrackInfo } from '../core/captions';
import { DEFAULT_DETECT, detectScenes } from '../core/detect';
import {
  MAX_VIDEO_DURATION_SEC,
  scanIntervalForDuration,
} from '../core/limits';
import type { PlayerInfo } from './bridge-client';
import { fetchCaptions } from './captions-fetch';
import { scanVideo } from './extractor';

export function extractionDurationError(isLive: boolean, durationSec: number): string | null {
  if (isLive || !Number.isFinite(durationSec) || durationSec <= 0) {
    return '라이브/프리미어 영상은 지원하지 않습니다.';
  }
  if (durationSec > MAX_VIDEO_DURATION_SEC) {
    return '최대 2시간 영상까지 지원합니다.';
  }
  return null;
}

export function scanMetaFields(
  captions: CaptionFetchResult,
  sampleIntervalSec: number,
) {
  return {
    sampleIntervalSec,
    captionsAvailable: captions.status === 'available',
    captionStatus: captions.status,
  } as const;
}

export interface PrepareCaptionedScanInput {
  video: HTMLVideoElement;
  info: PlayerInfo | null;
  urlVideoId: string | null;
  onProgress: (done: number, total: number) => void;
  onStage: (stage: string) => void;
  signal: AbortSignal;
}

export interface PrepareCaptionedScanDeps {
  fetchCaptions: (
    tracks: CaptionTrackInfo[],
    videoId: string,
    durationSec: number,
    signal: AbortSignal,
  ) => Promise<CaptionFetchResult>;
  scanVideo: typeof scanVideo;
  detectScenes: typeof detectScenes;
}

const browserDeps: PrepareCaptionedScanDeps = {
  fetchCaptions: (tracks, videoId, durationSec, signal) =>
    fetchCaptions(tracks, videoId, signal, undefined, durationSec),
  scanVideo,
  detectScenes,
};

export async function prepareCaptionedScan(
  input: PrepareCaptionedScanInput,
  deps: PrepareCaptionedScanDeps = browserDeps,
) {
  const videoId = input.info?.videoId ?? input.urlVideoId ?? 'unknown';

  input.onStage('자막 추출 중…');
  const captions: CaptionFetchResult = input.info
    ? await deps.fetchCaptions(
      input.info.captionTracks,
      videoId,
      input.video.duration,
      input.signal,
    )
    : { status: 'fetch-failed', reason: 'no-observed-url', cues: [] };

  if (captions.status === 'fetch-failed') {
    console.warn('[youtubook] 자막 추출 실패 — 자막 없이 진행합니다', captions.reason);
  }

  const sampleIntervalSec = scanIntervalForDuration(input.video.duration);
  input.onStage('장면 스캔 중…');
  const scan = await deps.scanVideo(
    input.video,
    sampleIntervalSec,
    input.onProgress,
    input.signal,
  );
  const detection = deps.detectScenes(scan.scores, {
    ...DEFAULT_DETECT,
    durationSec: input.video.duration,
    sampleIntervalSec,
  });

  return { videoId, captions, sampleIntervalSec, scan, detection };
}
