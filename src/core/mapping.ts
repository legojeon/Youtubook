import type { Cue } from './types';

/** [startSec, endSec) 구간과 겹치는 큐. 경계에 걸친 큐는 양쪽 장면에 모두 포함된다(의도된 동작). */
export function cuesForRange(cues: Cue[], startSec: number, endSec: number): Cue[] {
  return cues.filter(c => c.startSec < endSec && c.endSec > startSec);
}

export function scriptForRange(cues: Cue[], startSec: number, endSec: number): string {
  return cuesForRange(cues, startSec, endSec).map(c => c.text).join(' ');
}

export interface ScriptSpan {
  startSec: number;
  endSec: number;
}

/**
 * 선택 장면 시작점들로 전체 타임라인을 분할한다 — 각 장면이 "다음 선택 장면이
 * 나오기 전까지"의 자막을 모두 담당해 내레이션이 유실되지 않는다.
 * 첫 장면은 영상 처음부터, 마지막 장면은 영상 끝까지.
 */
export function scriptSpans(startsSec: number[], durationSec: number): ScriptSpan[] {
  return startsSec.map((start, i) => ({
    startSec: i === 0 ? 0 : start,
    endSec: i + 1 < startsSec.length ? startsSec[i + 1] : durationSec,
  }));
}
