import { describe, expect, it } from 'vitest';
import { cuesToSentences } from './sentences';

describe('cuesToSentences', () => {
  it('여러 cue에 걸친 문장을 하나로 합치고 첫 cue start / 끝 cue end를 부여한다', () => {
    const cues = [
      { startSec: 0, endSec: 1, text: 'Hello there.' },
      { startSec: 1, endSec: 2, text: 'How are' },
      { startSec: 2, endSec: 3, text: 'you today?' },
    ];
    expect(cuesToSentences(cues, 'en')).toEqual([
      { startSec: 0, endSec: 1, text: 'Hello there.' },
      { startSec: 1, endSec: 3, text: 'How are you today?' },
    ]);
  });

  it('한 문장이 3개 cue에 걸치면 첫 cue start와 끝 cue end로 합쳐진다', () => {
    const cues = [
      { startSec: 0, endSec: 1, text: 'The quick' },
      { startSec: 1, endSec: 2, text: 'brown fox' },
      { startSec: 2, endSec: 3, text: 'jumps.' },
    ];
    expect(cuesToSentences(cues, 'en')).toEqual([
      { startSec: 0, endSec: 3, text: 'The quick brown fox jumps.' },
    ]);
  });

  it('한국어 문장을 구두점 기준으로 나눈다', () => {
    const cues = [
      { startSec: 0, endSec: 2, text: '안녕하세요.' },
      { startSec: 2, endSec: 4, text: '오늘은 김치찌개를' },
      { startSec: 4, endSec: 6, text: '만들어 보겠습니다.' },
    ];
    expect(cuesToSentences(cues, 'ko')).toEqual([
      { startSec: 0, endSec: 2, text: '안녕하세요.' },
      { startSec: 2, endSec: 6, text: '오늘은 김치찌개를 만들어 보겠습니다.' },
    ]);
  });

  it('구두점이 전혀 없으면 cue를 그대로 반환한다 (ASR fallback)', () => {
    const cues = [
      { startSec: 0, endSec: 1, text: '안녕하세요 오늘은' },
      { startSec: 1, endSec: 2, text: '김치찌개를 만들어' },
    ];
    expect(cuesToSentences(cues, 'ko')).toEqual(cues);
  });

  it('빈 입력은 빈 배열', () => {
    expect(cuesToSentences([], 'en')).toEqual([]);
  });

  it('잘못된 locale에도 예외를 던지지 않고 문장을 반환한다', () => {
    const cues = [{ startSec: 0, endSec: 1, text: 'Hi. Bye.' }];
    expect(() => cuesToSentences(cues, 'not-a-locale!!')).not.toThrow();
    expect(cuesToSentences(cues, 'not-a-locale!!').length).toBeGreaterThan(0);
  });
});
