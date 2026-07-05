import { describe, expect, it } from 'vitest';
import { isHandledBackgroundMessage } from './message-routing';

describe('isHandledBackgroundMessage', () => {
  it.each([null, undefined, 1, 'x', {}, { type: 1 }, { type: 'FRAME_ACCEPTED' }])(
    'safely ignores malformed or unhandled input %#',
    value => {
      expect(isHandledBackgroundMessage(value)).toBe(false);
    },
  );

  it('accepts a handled message object', () => {
    expect(isHandledBackgroundMessage({ type: 'SESSION_COMMIT', sessionId: 'id' })).toBe(true);
  });
});
