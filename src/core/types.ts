import type { CaptionStatus } from './captions';

export interface SceneRange {
  startSec: number;
  endSec: number;
  repSec: number; // 대표 시점(구간 중앙) — 이 시점의 프레임을 캡처
}

export interface Cue {
  startSec: number;
  endSec: number;
  text: string;
}

export interface SessionMeta {
  id: string;
  videoId: string;
  title: string;
  videoUrl: string;
  tabId: number; // 원본 유튜브 탭 (SW가 sender에서 채움)
  durationSec: number;
  videoWidth: number;
  videoHeight: number;
  sampleIntervalSec: number;
  sensitivity: number; // 1~10
  captionsAvailable: boolean;
  captionStatus?: CaptionStatus;
  truncated: boolean; // 장면 300개 상한 초과 여부
  createdAt: number;
}

export interface SessionData {
  meta: SessionMeta;
  scores: number[];   // 샘플 i-1 → i 차이 점수 (scores[0] = 0)
  thumbs: string[];   // 샘플별 미니 썸네일 data URL (캡처 전 폴백 표시용)
  cues: Cue[];
  ranges: SceneRange[];             // 현재 민감도 기준 장면 구간
  images: Record<string, string>;   // repKey → 고해상도 JPEG data URL (재검출 간 캐시)
}

export function repKey(repSec: number): string {
  return repSec.toFixed(2);
}
