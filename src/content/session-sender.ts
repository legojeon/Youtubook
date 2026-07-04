import { THUMB_CHUNK_SIZE } from '../core/limits';
import { splitThumbs } from '../core/thumb-chunks';
import type { Msg, MsgResponse } from '../messages';

type SessionBegin = Extract<Msg, { type: 'SESSION_BEGIN' }>;
type SendMessage = (message: Msg) => Promise<MsgResponse>;

function checkResponse(response: MsgResponse, fallback: string): void {
  if (!response.ok) throw new Error(response.reason ?? fallback);
}

export async function sendSessionStart(
  send: SendMessage,
  begin: SessionBegin,
  thumbs: string[],
): Promise<void> {
  checkResponse(await send(begin), '세션 시작에 실패했습니다.');

  for (const chunk of splitThumbs(thumbs, THUMB_CHUNK_SIZE)) {
    const response = await send({ type: 'SESSION_THUMBS_CHUNK', ...chunk });
    checkResponse(response, '썸네일 전송에 실패했습니다.');
  }
}
