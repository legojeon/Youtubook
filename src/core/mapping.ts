import type { Cue } from './types';

/** 문장을 시작시각 기준으로 [startSec, endSec)에 배정한다. 한 문장은 시작이 속한 단 하나의
 *  구간에만 들어가 경계에서 쪼개지거나 중복되지 않는다. */
export function sentencesForRange(sentences: Cue[], startSec: number, endSec: number): Cue[] {
  return sentences.filter(s => s.startSec >= startSec && s.startSec < endSec);
}

export function scriptFromSentences(sentences: Cue[], startSec: number, endSec: number): string {
  return sentencesForRange(sentences, startSec, endSec).map(s => s.text).join(' ');
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
