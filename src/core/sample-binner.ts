export interface SampleBinner {
  readonly scores: number[];
  readonly thumbs: string[];
  /** 프레임 하나를 반영: mediaTimeSec = video.currentTime, score = 직전 전달 프레임과의
   *  frameContentScore(첫 프레임은 0), thumb = 해당 프레임 썸네일 data URL. */
  push(mediaTimeSec: number, score: number, thumb: string): void;
  /** 스트림 종료 시 열린 마지막 bin을 확정한다. */
  finish(): void;
}

/**
 * 프레임 단위 색차를 sampleIntervalSec 격자 샘플로 접는다. 인덱스 k ↔ 미디어시간 k·I를
 * 보장하고(선행/중간 bin을 score 0으로 채움), 같은 bin은 max로 누적해 컷 스파이크를 보존한다.
 */
export function createSampleBinner(sampleIntervalSec: number, maxSamples = Infinity): SampleBinner {
  const scores: number[] = [];
  const thumbs: string[] = [];
  const I = sampleIntervalSec > 0 ? sampleIntervalSec : 1;
  let open = false;
  let curBin = 0;
  let curMax = 0;
  let curThumb = '';

  const flush = (max: number, thumb: string) => {
    if (scores.length >= maxSamples) return;
    scores.push(max);
    thumbs.push(thumb);
  };

  return {
    scores,
    thumbs,
    push(mediaTimeSec, score, thumb) {
      const bin = mediaTimeSec > 0 ? Math.floor(mediaTimeSec / I) : 0;
      if (!open) {
        for (let k = 0; k < bin; k++) flush(0, thumb); // 선행 bin 채움
        open = true;
        curBin = bin;
        curMax = score;
        curThumb = thumb;
        return;
      }
      if (bin <= curBin) {
        if (score > curMax) curMax = score;
        curThumb = thumb;
        return;
      }
      flush(curMax, curThumb);                              // 현재 bin 확정
      for (let k = curBin + 1; k < bin; k++) flush(0, curThumb); // 건너뛴 중간 bin
      curBin = bin;
      curMax = score;
      curThumb = thumb;
    },
    finish() {
      if (open) flush(curMax, curThumb);
    },
  };
}
