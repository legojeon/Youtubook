import { MAX_CAPTION_EVENTS, MAX_VIDEO_DURATION_SEC, validateScanScores } from '../core/limits';
import type { Cue, SceneRange, SessionMeta } from '../core/types';
import type { Msg } from '../messages';

const MAX_ID_CHARS = 200;
const MAX_TITLE_CHARS = 1_000;
const MAX_VIDEO_URL_CHARS = 2_048;
const MAX_VIDEO_DIMENSION = 16_384;
const MAX_CUE_TEXT_CHARS = 10_000;
const MAX_SCENE_RANGES = 300;
export const MAX_TOTAL_CUE_TEXT_CHARS = 1_000_000;
export const MAX_SESSION_BEGIN_CHARS = 2 * 1024 * 1024;
const CAPTION_STATUSES = new Set(['available', 'absent', 'fetch-failed']);

function objectRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function finiteNumber(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be a finite number between ${min} and ${max}.`);
  }
  return value;
}

function safeInteger(value: unknown, label: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`${label} must be a safe integer between ${min} and ${max}.`);
  }
  return value as number;
}

function boundedString(
  value: unknown,
  label: string,
  maxChars: number,
  requireContent = false,
): string {
  if (typeof value !== 'string'
    || value.length > maxChars
    || (requireContent && !value.trim())) {
    throw new Error(`${label} must be a string within ${maxChars} characters.`);
  }
  return value;
}

export function validateId(value: unknown, label: string): asserts value is string {
  boundedString(value, label, MAX_ID_CHARS, true);
}

export function isYoutubeWatchUrl(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > MAX_VIDEO_URL_CHARS) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname === 'www.youtube.com'
      && url.pathname === '/watch';
  } catch {
    return false;
  }
}

function validateMeta(value: unknown): asserts value is SessionMeta {
  const meta = objectRecord(value, 'Session metadata');
  validateId(meta.id, 'Session ID');
  validateId(meta.videoId, 'Video ID');
  boundedString(meta.title, 'Session title', MAX_TITLE_CHARS);
  if (!isYoutubeWatchUrl(meta.videoUrl)) {
    throw new Error('Session video URL must be a valid YouTube watch URL.');
  }
  safeInteger(meta.tabId, 'Session tab ID', -1, Number.MAX_SAFE_INTEGER);
  finiteNumber(meta.durationSec, 'Video duration', Number.MIN_VALUE, MAX_VIDEO_DURATION_SEC);
  safeInteger(meta.videoWidth, 'Video width', 1, MAX_VIDEO_DIMENSION);
  safeInteger(meta.videoHeight, 'Video height', 1, MAX_VIDEO_DIMENSION);
  finiteNumber(meta.sampleIntervalSec, 'Sample interval', Number.MIN_VALUE, MAX_VIDEO_DURATION_SEC);
  safeInteger(meta.sensitivity, 'Sensitivity', 1, 10);
  if (typeof meta.captionsAvailable !== 'boolean') {
    throw new Error('Caption availability must be boolean.');
  }
  if (meta.captionStatus !== undefined
    && (typeof meta.captionStatus !== 'string' || !CAPTION_STATUSES.has(meta.captionStatus))) {
    throw new Error('Caption status is invalid.');
  }
  if (typeof meta.truncated !== 'boolean') throw new Error('Truncated status must be boolean.');
  safeInteger(meta.createdAt, 'Creation timestamp', 0, Number.MAX_SAFE_INTEGER);
}

function validateCues(value: unknown, durationSec: number): asserts value is Cue[] {
  if (!Array.isArray(value) || value.length > MAX_CAPTION_EVENTS) {
    throw new Error(`Cues must be an array with at most ${MAX_CAPTION_EVENTS} entries.`);
  }
  for (const valueCue of value) {
    const cue = objectRecord(valueCue, 'Cue');
    const startSec = finiteNumber(cue.startSec, 'Cue start', 0, durationSec);
    const endSec = finiteNumber(cue.endSec, 'Cue end', 0, durationSec);
    if (endSec < startSec) throw new Error('Cue end must not precede cue start.');
    boundedString(cue.text, 'Cue text', MAX_CUE_TEXT_CHARS);
  }
}

function validateRanges(value: unknown, durationSec: number): asserts value is SceneRange[] {
  if (!Array.isArray(value) || value.length > MAX_SCENE_RANGES) {
    throw new Error(`Scene ranges must be an array with at most ${MAX_SCENE_RANGES} entries.`);
  }
  let previousEnd = 0;
  for (const valueRange of value) {
    const range = objectRecord(valueRange, 'Scene range');
    const startSec = finiteNumber(range.startSec, 'Scene start', 0, durationSec);
    const endSec = finiteNumber(range.endSec, 'Scene end', 0, durationSec);
    const repSec = finiteNumber(range.repSec, 'Scene representative time', 0, durationSec);
    if (startSec >= endSec) throw new Error('Scene range start must precede its end.');
    if (startSec < previousEnd) throw new Error('Scene ranges must be ordered and non-overlapping.');
    if (repSec < startSec || repSec > endSec) {
      throw new Error('Scene representative time must be within its range.');
    }
    previousEnd = endSec;
  }
}

export function validateSessionBegin(
  message: Extract<Msg, { type: 'SESSION_BEGIN' }>,
): void {
  validateMeta(message.meta);
  validateScanScores(message.scores);
  validateCues(message.cues, message.meta.durationSec);
  validateRanges(message.ranges, message.meta.durationSec);
}

export function canonicalizeSessionBegin(
  message: Extract<Msg, { type: 'SESSION_BEGIN' }>,
  tabId: number,
): Omit<import('../storage/db').PendingSessionData, 'thumbs' | 'updatedAt'> {
  validateSessionBegin(message);
  const totalCueTextChars = message.cues.reduce((sum, cue) => sum + cue.text.length, 0);
  if (totalCueTextChars > MAX_TOTAL_CUE_TEXT_CHARS) {
    throw new Error('Aggregate cue text exceeds the session limit.');
  }

  const canonical = {
    meta: {
      id: message.meta.id,
      videoId: message.meta.videoId,
      title: message.meta.title,
      videoUrl: message.meta.videoUrl,
      tabId,
      durationSec: message.meta.durationSec,
      videoWidth: message.meta.videoWidth,
      videoHeight: message.meta.videoHeight,
      sampleIntervalSec: message.meta.sampleIntervalSec,
      sensitivity: message.meta.sensitivity,
      captionsAvailable: message.meta.captionsAvailable,
      ...(message.meta.captionStatus === undefined
        ? {}
        : { captionStatus: message.meta.captionStatus }),
      truncated: message.meta.truncated,
      createdAt: message.meta.createdAt,
    },
    scores: message.scores.map(score => score),
    cues: message.cues.map(cue => ({
      startSec: cue.startSec,
      endSec: cue.endSec,
      text: cue.text,
    })),
    ranges: message.ranges.map(range => ({
      startSec: range.startSec,
      endSec: range.endSec,
      repSec: range.repSec,
    })),
  };
  if (JSON.stringify(canonical).length > MAX_SESSION_BEGIN_CHARS) {
    throw new Error('Session payload exceeds the aggregate size limit.');
  }
  return canonical;
}
