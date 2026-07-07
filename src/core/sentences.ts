import type { Cue } from './types';

const SENTENCE_TERMINATORS = /[.?!。？！…]/;

interface CueSpan {
  start: number; // 이어붙인 문자열에서 이 cue 텍스트의 시작 오프셋(포함)
  end: number;   // 끝 오프셋(제외)
  cue: Cue;
}

/** [start, end)가 offset을 덮는 span의 인덱스. offset은 실제(비공백) 문자를 가리킨다고 가정. */
function spanIndexAt(spans: CueSpan[], offset: number): number {
  let lo = 0;
  let hi = spans.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (offset < spans[mid].start) hi = mid - 1;
    else if (offset >= spans[mid].end) lo = mid + 1;
    else return mid;
  }
  return Math.min(Math.max(lo, 0), spans.length - 1);
}

/**
 * 자막 cue들을 문장 단위로 재조립한다. 구두점이 있으면 Intl.Segmenter로 문장을 나누고
 * 각 문장에 (첫 cue의 startSec, 끝 cue의 endSec)을 부여한다. 구두점이 전혀 없으면
 * (주로 ASR) 세그멘터를 쓰지 않고 cue를 그대로 반환한다. 반환 타입은 Cue로 동일하다.
 */
export function cuesToSentences(cues: Cue[], lang?: string): Cue[] {
  if (cues.length === 0) return [];

  let joined = '';
  const spans: CueSpan[] = [];
  for (const cue of cues) {
    if (joined) joined += ' ';
    const start = joined.length;
    joined += cue.text;
    spans.push({ start, end: joined.length, cue });
  }

  // 종결부호가 하나도 없으면 문장 경계를 만들 근거가 없다 → cue 그대로.
  if (!SENTENCE_TERMINATORS.test(joined)) return cues.map(c => ({ ...c }));

  let segmenter: Intl.Segmenter;
  try {
    segmenter = new Intl.Segmenter(lang, { granularity: 'sentence' });
  } catch {
    try {
      segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' });
    } catch {
      return cues.map(c => ({ ...c })); // Intl.Segmenter 미지원 → cue 그대로
    }
  }

  const sentences: Cue[] = [];
  for (const { segment, index } of segmenter.segment(joined)) {
    const text = segment.trim();
    if (!text) continue;

    // 세그먼트 내 첫/끝 비공백 문자 위치로 시작·끝 cue를 찾는다.
    const segEnd = index + segment.length;
    let s = index;
    while (s < segEnd && joined[s] === ' ') s++;
    let e = segEnd - 1;
    while (e > index && joined[e] === ' ') e--;

    const startCue = spans[spanIndexAt(spans, s)].cue;
    const endCue = spans[spanIndexAt(spans, e)].cue;
    const startSec = startCue.startSec;
    const endSec = Math.max(endCue.endSec, startSec);
    sentences.push({ startSec, endSec, text });
  }
  return sentences;
}
