import { describe, expect, it } from 'vitest';
import { scriptFromSentences, scriptSpans, sentencesForRange } from './mapping';

const sentences = [
  { startSec: 0, endSec: 3, text: 'A.' },
  { startSec: 3, endSec: 6, text: 'B.' },
  { startSec: 6, endSec: 9, text: 'C.' },
];

describe('sentencesForRange', () => {
  it('시작시각이 [start, end)에 드는 문장만 반환한다', () => {
    expect(sentencesForRange(sentences, 0, 3)).toEqual([{ startSec: 0, endSec: 3, text: 'A.' }]);
    expect(sentencesForRange(sentences, 3, 6)).toEqual([{ startSec: 3, endSec: 6, text: 'B.' }]);
  });

  it('경계에서 시작하는 문장은 정확히 한 구간에만 배정된다 (중복 없음)', () => {
    const inFirst = sentencesForRange(sentences, 0, 3).some(s => s.text === 'B.');
    const inSecond = sentencesForRange(sentences, 3, 6).some(s => s.text === 'B.');
    expect(inFirst).toBe(false);
    expect(inSecond).toBe(true);
  });
});

describe('scriptFromSentences', () => {
  it('구간 내 문장을 공백으로 이어붙인다', () => {
    expect(scriptFromSentences(sentences, 0, 6)).toBe('A. B.');
  });
});

describe('scriptSpans (기존 동작 회귀)', () => {
  it('선택 시작점들로 타임라인을 분할한다', () => {
    expect(scriptSpans([2, 5], 10)).toEqual([
      { startSec: 0, endSec: 5 },
      { startSec: 5, endSec: 10 },
    ]);
  });
});
