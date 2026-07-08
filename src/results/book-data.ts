import { scriptFromSentences, scriptSpans } from '../core/mapping';
import { repKey, type Cue, type SceneRange, type SessionData } from '../core/types';
import type { BookData } from './html-book';

export interface SelectedScene {
  range: SceneRange;
  image: string;
  script: string;
  scriptStartSec: number; // 이 장면이 담당하는 대본 구간 (선택 장면 기준 타임라인 분할)
  scriptEndSec: number;
}

export function thumbFor(session: SessionData, repSec: number): string {
  const i = Math.min(session.thumbs.length - 1, Math.floor(repSec / session.meta.sampleIntervalSec));
  return session.thumbs[i] ?? '';
}

export function imageFor(session: SessionData, range: SceneRange): string {
  return session.images[repKey(range.repSec)] ?? thumbFor(session, range.repSec);
}

/** 선택된 repKey들로 장면을 골라 대본 구간을 분할한다. results/뷰어 공유. */
export function selectedScenes(
  session: SessionData,
  sentences: Cue[],
  keys: Iterable<string>,
): SelectedScene[] {
  const keySet = keys instanceof Set ? keys : new Set(keys);
  const picked = session.ranges
    .filter(r => keySet.has(repKey(r.repSec)))
    .sort((a, b) => a.startSec - b.startSec);
  // 선택 장면들로 전체 타임라인을 분할 — 각 장면이 다음 선택 장면 전까지의
  // 자막을 모두 가져가 내레이션이 빠지지 않는다.
  const spans = scriptSpans(picked.map(r => r.startSec), session.meta.durationSec);
  return picked.map((range, i) => ({
    range,
    image: imageFor(session, range),
    script: scriptFromSentences(sentences, spans[i].startSec, spans[i].endSec),
    scriptStartSec: spans[i].startSec,
    scriptEndSec: spans[i].endSec,
  }));
}

/** 선택 장면 → 책 데이터. `resize`로 각 이미지를 재인코딩(다운스케일 여부는 호출부가 결정). */
export async function buildBookData(
  scenes: SelectedScene[],
  meta: SessionData['meta'],
  resize: (dataUrl: string) => Promise<string>,
): Promise<BookData> {
  const images = await Promise.all(scenes.map(s => resize(s.image)));
  return {
    title: meta.title,
    videoUrl: meta.videoUrl,
    videoId: meta.videoId,
    cover: { title: meta.title, image: images[0] ?? '' },
    scenes: scenes.map((s, i) => ({
      image: images[i],
      script: s.script,
      deepLinkSec: s.range.repSec,
    })),
  };
}
