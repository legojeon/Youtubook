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
  | { type: 'SESSION_THUMBS_CHUNK'; sessionId: string; startIndex: number; thumbs: string[] }
  | { type: 'SESSION_IMAGE'; sessionId: string; key: string; dataUrl: string }
  | { type: 'SESSION_COMMIT'; sessionId: string } // SW가 저장 + 결과 탭 오픈 + 세션 정리
  // 결과 페이지 → SW → 콘텐츠: 재캡처
  | { type: 'REQUEST_CAPTURES'; sessionId: string; reps: RepRef[] }
  | { type: 'CAPTURE_FRAMES'; sessionId: string; videoId: string; reps: RepRef[] }
  // 콘텐츠 → SW: 재캡처 업로드. SW 저장 성공 후에만 FRAME_ACCEPTED를 브로드캐스트한다.
  | { type: 'FRAME_UPLOAD'; sessionId: string; key: string; dataUrl: string }
  | { type: 'FRAME_ACCEPTED'; sessionId: string; key: string; dataUrl: string }
  // 콘텐츠 → SW: 추출 진행상황/종료 (배지·상태용)
  | { type: 'EXTRACTION_PROGRESS'; percent: number; stage: string }
  | { type: 'EXTRACTION_ENDED'; reason: 'cancelled' | 'error' }
  // 팝업 → SW: 상태 조회 / 취소. CANCEL_EXTRACTION은 SW → 콘텐츠로도 재사용된다.
  | { type: 'GET_EXTRACTION_STATUS' }
  | { type: 'CANCEL_EXTRACTION' };

export interface MsgResponse {
  ok: boolean;
  reason?: string; // 'tab-closed' | 'wrong-video' | 기타 오류 설명
}

/** GET_EXTRACTION_STATUS 응답 (MsgResponse와 별개). stage는 i18n 키. */
export interface ExtractionStatus {
  running: boolean;
  percent: number;
  stage: string;
}
