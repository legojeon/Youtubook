import { THUMB_CHUNK_SIZE } from './limits';

export interface ThumbChunk {
  startIndex: number;
  thumbs: string[];
}

// 160px-wide JPEG data URLs are normally far smaller; 256 KiB leaves ample
// headroom for unusual aspect ratios while bounding untrusted message payloads.
export const MAX_THUMB_DATA_URL_LENGTH = 256 * 1024;
// Generated JPEG data URLs are ASCII, so characters equal UTF-8 bytes. 128 MiB
// supports 3,600 thumbnails averaging more than 32 KiB while bounding a session.
export const MAX_SESSION_THUMB_CHARS = 128 * 1024 * 1024;

export function validateThumbChunk(
  startIndex: unknown,
  thumbs: unknown,
  expectedLength: number,
): asserts thumbs is string[] {
  if (!Number.isSafeInteger(startIndex) || (startIndex as number) < 0) {
    throw new Error('Thumbnail chunk start index must be a non-negative safe integer.');
  }
  if (!Number.isSafeInteger(expectedLength) || expectedLength < 0) {
    throw new Error('Expected thumbnail count must be a non-negative safe integer.');
  }
  if (!Array.isArray(thumbs)) {
    throw new Error('Thumbnail chunk must be an array.');
  }
  if (thumbs.length < 1 || thumbs.length > THUMB_CHUNK_SIZE) {
    throw new Error(`Thumbnail chunk length must be between 1 and ${THUMB_CHUNK_SIZE}.`);
  }
  if ((startIndex as number) > expectedLength - thumbs.length) {
    throw new Error('Thumbnail chunk exceeds the expected thumbnail count.');
  }
  for (const thumb of thumbs) {
    if (typeof thumb !== 'string'
      || thumb.length === 0
      || thumb.length > MAX_THUMB_DATA_URL_LENGTH) {
      throw new Error('Thumbnail entries must be non-empty strings within the size limit.');
    }
  }
}

export function splitThumbs(thumbs: string[], size: number): ThumbChunk[] {
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new Error('Thumbnail chunk size must be a positive integer.');
  }

  const chunks: ThumbChunk[] = [];
  for (let startIndex = 0; startIndex < thumbs.length; startIndex += size) {
    chunks.push({ startIndex, thumbs: thumbs.slice(startIndex, startIndex + size) });
  }
  return chunks;
}

export function applyThumbChunk(
  target: string[],
  startIndex: number,
  thumbs: string[],
  maxTotalChars = MAX_SESSION_THUMB_CHARS,
): void {
  if (!Number.isSafeInteger(startIndex) || startIndex < 0) {
    throw new Error('Thumbnail chunk start index must be a non-negative safe integer.');
  }
  if (!Array.isArray(thumbs)) {
    throw new Error('Thumbnail chunk must be an array.');
  }
  if (!Number.isSafeInteger(maxTotalChars) || maxTotalChars < 0) {
    throw new Error('Thumbnail session budget must be a non-negative safe integer.');
  }

  let totalChars = 0;
  for (let index = 0; index < target.length; index++) {
    if (Object.hasOwn(target, index)) totalChars += target[index].length;
  }
  let addedChars = 0;
  for (let offset = 0; offset < thumbs.length; offset++) {
    const index = startIndex + offset;
    if (Object.hasOwn(target, index) && target[index] !== thumbs[offset]) {
      throw new Error('Conflicting thumbnail chunks must not overlap.');
    }
    if (!Object.hasOwn(target, index)) addedChars += thumbs[offset].length;
  }
  if (totalChars > maxTotalChars - addedChars) {
    throw new Error('Thumbnail session exceeds the aggregate size limit.');
  }
  for (let offset = 0; offset < thumbs.length; offset++) {
    target[startIndex + offset] = thumbs[offset];
  }
}

export function thumbsComplete(thumbs: string[], expectedLength: number): boolean {
  if (!Number.isInteger(expectedLength) || expectedLength < 0 || thumbs.length !== expectedLength) {
    return false;
  }
  for (let index = 0; index < expectedLength; index++) {
    if (!Object.hasOwn(thumbs, index)
      || typeof thumbs[index] !== 'string'
      || thumbs[index].length === 0) {
      return false;
    }
  }
  return true;
}
