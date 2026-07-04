import type { TimedtextQuery } from '../core/timedtext';

const MAX_REQUEST_ID_LENGTH = 128;
const MAX_VIDEO_ID_LENGTH = 128;
const MAX_LANGUAGE_CODE_LENGTH = 64;
const MAX_KIND_LENGTH = 32;

export interface BridgeRequest {
  source: 'youtubook-cs';
  cmd: string;
  reqId: string;
  payload?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length <= maxLength;
}

export function parseBridgeRequest(value: unknown): BridgeRequest | null {
  if (
    !isRecord(value) ||
    value.source !== 'youtubook-cs' ||
    typeof value.cmd !== 'string' ||
    !isBoundedString(value.reqId, MAX_REQUEST_ID_LENGTH) ||
    value.reqId.trim().length === 0
  ) {
    return null;
  }

  return {
    source: 'youtubook-cs',
    cmd: value.cmd,
    reqId: value.reqId,
    payload: value.payload,
  };
}

export function parseTimedtextQuery(value: unknown): TimedtextQuery | null {
  if (
    !isRecord(value) ||
    !isBoundedString(value.videoId, MAX_VIDEO_ID_LENGTH) ||
    value.videoId.trim().length === 0
  ) {
    return null;
  }

  const { languageCode, kind, afterStartTime } = value;
  if (languageCode !== undefined && !isBoundedString(languageCode, MAX_LANGUAGE_CODE_LENGTH)) {
    return null;
  }
  if (kind !== undefined && !isBoundedString(kind, MAX_KIND_LENGTH)) return null;
  if (
    afterStartTime !== undefined &&
    (typeof afterStartTime !== 'number' || !Number.isFinite(afterStartTime) || afterStartTime < 0)
  ) {
    return null;
  }

  return {
    videoId: value.videoId,
    ...(languageCode === undefined ? {} : { languageCode }),
    ...(kind === undefined ? {} : { kind }),
    ...(afterStartTime === undefined ? {} : { afterStartTime }),
  };
}
