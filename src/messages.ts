import type { Cue, SceneRange, SessionMeta } from './core/types';

export interface RepRef {
  key: string;    // repKey(repSec)
  repSec: number;
}

export type Msg =
  // 팝업 → 콘텐츠
  | { type: 'START_EXTRACTION' }
  // 콘텐츠 → SW: 세션 전송 (청크)
  | { type: 'SESSION_BEGIN'; meta: SessionMeta; scores: number[]; cues: Cue[]; ranges: SceneRange[] }
  | { type: 'SESSION_THUMBS_CHUNK'; startIndex: number; thumbs: string[] }
  | { type: 'SESSION_IMAGE'; key: string; dataUrl: string }
  | { type: 'SESSION_COMMIT' } // SW가 저장 + 결과 탭 오픈 + 세션 정리
  // 결과 페이지 → SW → 콘텐츠: 재캡처
  | { type: 'REQUEST_CAPTURES'; sessionId: string; reps: RepRef[] }
  | { type: 'CAPTURE_FRAMES'; sessionId: string; videoId: string; reps: RepRef[] }
  // 콘텐츠 → 모든 확장 컨텍스트: 재캡처 프레임 (SW는 DB 갱신, 결과 페이지는 UI 갱신)
  | { type: 'FRAME_READY'; sessionId: string; key: string; dataUrl: string };

export interface MsgResponse {
  ok: boolean;
  reason?: string; // 'tab-closed' | 'wrong-video' | 기타 오류 설명
}
