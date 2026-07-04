export interface ThumbChunk {
  startIndex: number;
  thumbs: string[];
}

export function splitThumbs(thumbs: string[], size: number): ThumbChunk[] {
  if (!Number.isInteger(size) || size <= 0) {
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
): void {
  if (!Number.isInteger(startIndex) || startIndex < 0) {
    throw new Error('Thumbnail chunk start index must be a non-negative integer.');
  }

  for (let offset = 0; offset < thumbs.length; offset++) {
    if (Object.hasOwn(target, startIndex + offset)) {
      throw new Error('Thumbnail chunks must not overlap.');
    }
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
