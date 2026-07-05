import { describe, expect, it } from 'vitest';
import { acceptedFrameMessage } from './accepted-frame';

describe('acceptedFrameMessage', () => {
  it.each([
    null,
    {},
    { type: 'FRAME_UPLOAD', sessionId: 's', key: '0.50', dataUrl: 'data:image/jpeg;base64,x' },
    { type: 'FRAME_ACCEPTED', sessionId: 1, key: '0.50', dataUrl: 'data:image/jpeg;base64,x' },
    { type: 'FRAME_ACCEPTED', sessionId: 's', key: null, dataUrl: 'data:image/jpeg;base64,x' },
    { type: 'FRAME_ACCEPTED', sessionId: 's', key: '0.50', dataUrl: 1 },
    { type: 'FRAME_ACCEPTED', sessionId: 's', key: 'not-a-key', dataUrl: 'data:image/jpeg;base64,x' },
    { type: 'FRAME_ACCEPTED', sessionId: 's', key: '0.50', dataUrl: 'https://example.com/x' },
  ])('rejects malformed payload %#', value => {
    expect(acceptedFrameMessage(value)).toBeNull();
  });

  it('returns a structurally valid accepted frame', () => {
    const value = {
      type: 'FRAME_ACCEPTED', sessionId: 's', key: '0.50',
      dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
    } as const;

    expect(acceptedFrameMessage(value)).toEqual(value);
  });
});
