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
  // 콘텐츠 → SW: 광고가 25초 넘게 안 끝남 → 사용자에게 건너뛰기 요청 알림
  | { type: 'AD_STUCK' }
  // 팝업 → SW: 상태 조회 / 취소. CANCEL_EXTRACTION은 SW → 콘텐츠로도 재사용된다.
  | { type: 'GET_EXTRACTION_STATUS' }
  | { type: 'CANCEL_EXTRACTION' };

export interface MsgResponse {
  ok: boolean;
  reason?: string; // 'tab-closed' | 'wrong-video' | 기타 오류 설명
}

/**
 * The SW rejects a session message whose sender ?v= no longer matches the bound video. YouTube can
 * briefly pushState the tab URL to another video near the end (autoplay/up-next prep) or around
 * ads and then revert it, so a frame upload can race that blip and be rejected even though the tab
 * never actually left our video. The content script retries this specific rejection while it can
 * confirm the video hasn't truly changed. Shared so the SW throw and the retry check stay in sync.
 */
export const SENDER_VIDEO_MISMATCH_REASON = 'Sender URL does not match the session video.';

/** GET_EXTRACTION_STATUS 응답 (MsgResponse와 별개). stage는 i18n 키. */
export interface ExtractionStatus {
  running: boolean;
  percent: number;
  stage: string;
}
