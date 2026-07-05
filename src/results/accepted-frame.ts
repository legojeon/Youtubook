import type { Msg } from '../messages';

type AcceptedFrame = Extract<Msg, { type: 'FRAME_ACCEPTED' }>;

export function acceptedFrameMessage(value: unknown): AcceptedFrame | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Partial<AcceptedFrame>;
  if (candidate.type !== 'FRAME_ACCEPTED'
    || typeof candidate.sessionId !== 'string'
    || !candidate.sessionId
    || typeof candidate.key !== 'string'
    || !/^\d+\.\d{2}$/.test(candidate.key)
    || typeof candidate.dataUrl !== 'string'
    || !candidate.dataUrl.startsWith('data:image/jpeg;base64,')) {
    return null;
  }
  return candidate as AcceptedFrame;
}
