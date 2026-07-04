import { describe, expect, it } from 'vitest';
import { parseBridgeRequest, parseTimedtextQuery } from './bridge-request';

describe('parseBridgeRequest', () => {
  it('accepts a bounded request ID from the content-script source', () => {
    expect(parseBridgeRequest({
      source: 'youtubook-cs',
      cmd: 'GET_TIMEDTEXT_URL',
      reqId: 'yb-1',
      payload: { videoId: 'video-1' },
    })).toMatchObject({ cmd: 'GET_TIMEDTEXT_URL', reqId: 'yb-1' });
  });

  it.each([
    null,
    [],
    { source: 'other', cmd: 'GET_TIMEDTEXT_URL', reqId: 'yb-1' },
    { source: 'youtubook-cs', cmd: 7, reqId: 'yb-1' },
    { source: 'youtubook-cs', cmd: 'GET_TIMEDTEXT_URL', reqId: '' },
    { source: 'youtubook-cs', cmd: 'GET_TIMEDTEXT_URL', reqId: ' '.repeat(2) },
    { source: 'youtubook-cs', cmd: 'GET_TIMEDTEXT_URL', reqId: 'x'.repeat(129) },
  ])('rejects a malformed request envelope (%j)', candidate => {
    expect(parseBridgeRequest(candidate)).toBeNull();
  });
});

describe('parseTimedtextQuery', () => {
  it('copies a fully valid bounded query', () => {
    expect(parseTimedtextQuery({
      videoId: 'video-1',
      languageCode: 'en',
      kind: 'asr',
      afterStartTime: 12.5,
    })).toEqual({
      videoId: 'video-1',
      languageCode: 'en',
      kind: 'asr',
      afterStartTime: 12.5,
    });
  });

  it.each([
    null,
    [],
    {},
    { videoId: '' },
    { videoId: ' ' },
    { videoId: 'v'.repeat(129) },
    { videoId: 7 },
    { videoId: 'video-1', languageCode: 7 },
    { videoId: 'video-1', languageCode: 'l'.repeat(65) },
    { videoId: 'video-1', kind: 7 },
    { videoId: 'video-1', kind: 'k'.repeat(33) },
    { videoId: 'video-1', afterStartTime: -1 },
    { videoId: 'video-1', afterStartTime: Number.NaN },
    { videoId: 'video-1', afterStartTime: Number.POSITIVE_INFINITY },
    { videoId: 'video-1', afterStartTime: '12' },
  ])('rejects a malformed timedtext payload (%j)', candidate => {
    expect(parseTimedtextQuery(candidate)).toBeNull();
  });
});
