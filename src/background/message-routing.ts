import type { Msg } from '../messages';

const HANDLED = new Set<Msg['type']>([
  'SESSION_BEGIN',
  'SESSION_THUMBS_CHUNK',
  'SESSION_IMAGE',
  'SESSION_COMMIT',
  'REQUEST_CAPTURES',
  'FRAME_UPLOAD',
]);

export function isHandledBackgroundMessage(value: unknown): value is Msg {
  if (typeof value !== 'object' || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === 'string' && HANDLED.has(type as Msg['type']);
}
