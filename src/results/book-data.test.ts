import { describe, expect, it } from 'vitest';
import type { Cue, SessionData } from '../core/types';
import { buildBookData, imageFor, selectedScenes } from './book-data';

const IMG = 'data:image/jpeg;base64,AAAA';

function session(overrides: Partial<SessionData> = {}): SessionData {
  return {
    meta: {
      id: 's1', videoId: 'vid', title: '제목', videoUrl: 'https://youtu.be/vid',
      tabId: 1, durationSec: 60, videoWidth: 1920, videoHeight: 1080,
      sampleIntervalSec: 1, sensitivity: 5, captionsAvailable: true,
      truncated: false, createdAt: 0,
    },
    scores: [], thumbs: ['t0', 't1', 't2'], cues: [],
    ranges: [
      { startSec: 10, endSec: 20, repSec: 15 },
      { startSec: 0, endSec: 10, repSec: 5 },
    ],
    images: { '15.00': IMG },
    ...overrides,
  };
}

const sentences: Cue[] = [
  { startSec: 0, endSec: 8, text: '첫 문장.' },
  { startSec: 12, endSec: 18, text: '둘째 문장.' },
];

describe('selectedScenes', () => {
  it('선택된 키만 골라 startSec 오름차순으로 정렬한다', () => {
    const out = selectedScenes(session(), sentences, ['15.00', '5.00']);
    expect(out.map(s => s.range.repSec)).toEqual([5, 15]);
  });

  it('이미지가 있으면 캡처를, 없으면 썸네일 폴백을 쓴다', () => {
    const out = selectedScenes(session(), sentences, ['5.00', '15.00']);
    // repSec 5 → 캡처 없음 → thumbs[floor(5/1)=… clamp 2] = 't2'
    expect(out[0].image).toBe('t2');
    // repSec 15 → images['15.00'] = IMG
    expect(out[1].image).toBe(IMG);
  });

  it('선택 장면 기준으로 대본 구간을 분할한다', () => {
    const out = selectedScenes(session(), sentences, ['5.00', '15.00']);
    expect(out[0].scriptStartSec).toBe(0);
    // 다음 선택 장면(startSec 10) 전까지
    expect(out[0].scriptEndSec).toBe(10);
    expect(out[1].scriptStartSec).toBe(10);
    expect(out[1].scriptEndSec).toBe(60);
  });
});

describe('imageFor', () => {
  it('캡처가 없으면 sampleInterval로 계산한 썸네일을 준다', () => {
    expect(imageFor(session(), { startSec: 0, endSec: 2, repSec: 1 })).toBe('t1');
  });
});

describe('buildBookData', () => {
  it('resize를 각 장면 이미지에 적용하고 첫 장면을 표지로 쓴다', async () => {
    const scenes = selectedScenes(session(), sentences, ['5.00', '15.00']);
    const book = await buildBookData(scenes, session().meta, async u => `R:${u}`);
    expect(book.cover.image).toBe('R:t2');
    expect(book.scenes.map(s => s.image)).toEqual(['R:t2', `R:${IMG}`]);
    expect(book.scenes.map(s => s.deepLinkSec)).toEqual([5, 15]);
    expect(book.videoId).toBe('vid');
  });

  it('장면이 없으면 표지 이미지는 빈 문자열이다', async () => {
    const book = await buildBookData([], session().meta, async u => u);
    expect(book.cover.image).toBe('');
    expect(book.scenes).toHaveLength(0);
  });
});
