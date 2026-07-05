import { describe, expect, it, vi } from 'vitest';
import type { PlayerInfo } from './bridge-client';
import {
  extractionDurationError,
  prepareCaptionedScan,
  scanMetaFields,
} from './extraction-orchestration';

const info: PlayerInfo = {
  videoId: 'player-video',
  title: 'Video',
  isLive: false,
  captionTracks: [],
};

describe('extractionDurationError', () => {
  it('accepts the two-hour boundary and rejects a duration above it', () => {
    expect(extractionDurationError(false, 7200)).toBeNull();
    expect(extractionDurationError(false, 7200.01)).toBe('최대 2시간 영상까지 지원합니다.');
  });

  it('keeps live and invalid durations on the existing message', () => {
    expect(extractionDurationError(true, 60)).toBe('라이브/프리미어 영상은 지원하지 않습니다.');
    expect(extractionDurationError(false, Number.NaN))
      .toBe('라이브/프리미어 영상은 지원하지 않습니다.');
  });
});

describe('prepareCaptionedScan', () => {
  it('finishes caption extraction before scanning and passes/stores the adaptive interval', async () => {
    const events: string[] = [];
    const fetchCaptions = vi.fn(async () => {
      events.push('captions:done');
      return {
        status: 'available' as const,
        cues: [{ startSec: 0, endSec: 1, text: 'hello' }],
      };
    });
    const scanVideo = vi.fn(async (_video, intervalSec: number) => {
      events.push(`scan:${intervalSec}`);
      return { scores: [0], thumbs: ['thumb'] };
    });
    const detectScenes = vi.fn(() => ({ ranges: [], truncated: false }));

    const signal = new AbortController().signal;
    const result = await prepareCaptionedScan({
      video: { duration: 7200 } as HTMLVideoElement,
      info,
      urlVideoId: 'url-video',
      onProgress: () => {},
      onStage: events.push.bind(events),
      signal,
    }, { fetchCaptions, scanVideo, detectScenes });

    expect(events).toEqual([
      '자막 추출 중…',
      'captions:done',
      '장면 스캔 중…',
      'scan:2',
    ]);
    expect(result.videoId).toBe('player-video');
    expect(fetchCaptions).toHaveBeenCalledWith(info.captionTracks, 'player-video', 7200, signal);
    expect(result.sampleIntervalSec).toBe(2);
    expect(scanMetaFields(result.captions, result.sampleIntervalSec)).toEqual({
      sampleIntervalSec: 2,
      captionsAvailable: true,
      captionStatus: 'available',
    });
    expect(detectScenes).toHaveBeenCalledWith([0], expect.objectContaining({
      durationSec: 7200,
      sampleIntervalSec: 2,
    }));
  });

  it('rejects caption cancellation without starting the scene scan', async () => {
    const controller = new AbortController();
    const stages: string[] = [];
    const fetchCaptions = vi.fn(async (
      _tracks,
      _videoId,
      _durationSec,
      signal?: AbortSignal,
    ) => {
      controller.abort();
      signal?.throwIfAborted();
      return { status: 'absent' as const, cues: [] as [] };
    });
    const scanVideo = vi.fn();

    await expect(prepareCaptionedScan({
      video: { duration: 60 } as HTMLVideoElement,
      info,
      urlVideoId: null,
      onProgress: () => {},
      onStage: stage => stages.push(stage),
      signal: controller.signal,
    }, {
      fetchCaptions,
      scanVideo,
      detectScenes: vi.fn(),
    })).rejects.toMatchObject({ name: 'AbortError' });

    expect(scanVideo).not.toHaveBeenCalled();
    expect(stages).toEqual(['자막 추출 중…']);
  });

  it('uses a fetch-failed empty-cue fallback without calling caption fetch when info is null', async () => {
    const fetchCaptions = vi.fn();

    const result = await prepareCaptionedScan({
      video: { duration: 60 } as HTMLVideoElement,
      info: null,
      urlVideoId: null,
      onProgress: () => {},
      onStage: () => {},
      signal: new AbortController().signal,
    }, {
      fetchCaptions,
      scanVideo: vi.fn(async () => ({ scores: [0], thumbs: ['thumb'] })),
      detectScenes: vi.fn(() => ({ ranges: [], truncated: false })),
    });

    expect(fetchCaptions).not.toHaveBeenCalled();
    expect(result.videoId).toBe('unknown');
    expect(result.captions).toEqual({
      status: 'fetch-failed',
      reason: 'no-observed-url',
      cues: [],
    });
    expect(scanMetaFields(result.captions, result.sampleIntervalSec))
      .toEqual(expect.objectContaining({
        captionsAvailable: false,
        captionStatus: 'fetch-failed',
      }));
  });

  it('logs only the final caption failure reason and continues scene extraction', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const scanVideo = vi.fn(async () => ({ scores: [0], thumbs: ['thumb'] }));
    try {
      const result = await prepareCaptionedScan({
        video: { duration: 60 } as HTMLVideoElement,
        info,
        urlVideoId: null,
        onProgress: () => {},
        onStage: () => {},
        signal: new AbortController().signal,
      }, {
        fetchCaptions: vi.fn(async () => ({
          status: 'fetch-failed' as const,
          reason: 'parse-error' as const,
          cues: [] as [],
        })),
        scanVideo,
        detectScenes: vi.fn(() => ({ ranges: [], truncated: false })),
      });

      expect(result.captions).toEqual({ status: 'fetch-failed', reason: 'parse-error', cues: [] });
      expect(scanVideo).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalledWith('[youtubook] 자막 추출 실패 — 자막 없이 진행합니다', 'parse-error');
      expect(JSON.stringify(warn.mock.calls)).not.toContain('timedtext');
      expect(JSON.stringify(warn.mock.calls)).not.toContain('pot=');
    } finally {
      warn.mockRestore();
    }
  });
});
