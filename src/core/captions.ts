import type { Cue } from './types';
import {
  MAX_CAPTION_EVENTS,
  MAX_CUE_TEXT_CHARS,
  MAX_TOTAL_CUE_TEXT_CHARS,
  MAX_VIDEO_DURATION_SEC,
} from './limits';

export type CaptionStatus = 'available' | 'absent' | 'fetch-failed';

export type CaptionFailureReason =
  | 'direct-empty'
  | 'no-observed-url'
  | 'player-timeout'
  | 'invalid-url'
  | 'parse-error'
  | 'too-many-events';

export type CaptionFetchResult =
  | { status: 'available'; cues: Cue[] }
  | { status: 'absent'; cues: [] }
  | { status: 'fetch-failed'; reason: CaptionFailureReason; cues: [] };

export function captionStatusForMeta(meta: {
  captionStatus?: CaptionStatus;
  captionsAvailable: boolean;
}): CaptionStatus {
  return meta.captionStatus ?? (meta.captionsAvailable ? 'available' : 'absent');
}

export interface CaptionTrackInfo {
  baseUrl: string;
  languageCode: string;
  kind?: string; // 'asr' = 자동 생성
  label?: string;
}

interface Json3Event {
  tStartMs?: number;
  dDurationMs?: number;
  aAppend?: number;
  segs?: { utf8?: string }[];
}

export class CaptionParseError extends Error {
  constructor() {
    super('malformed-cues');
    this.name = 'CaptionParseError';
  }
}

function malformed(): never {
  throw new CaptionParseError();
}

export function parseJson3(raw: unknown, durationSec = MAX_VIDEO_DURATION_SEC): Cue[] {
  if (!Number.isFinite(durationSec) || durationSec <= 0 || durationSec > MAX_VIDEO_DURATION_SEC) {
    malformed();
  }
  const events = (raw as { events?: Json3Event[] } | null)?.events;
  if (!Array.isArray(events)) return [];
  if (events.length > MAX_CAPTION_EVENTS) throw new Error('too-many-events');
  const cues: Cue[] = [];
  let totalTextChars = 0;
  for (const ev of events) {
    if (!ev || ev.aAppend === 1 || ev.segs === undefined) continue;
    if (!Array.isArray(ev.segs)
      || typeof ev.tStartMs !== 'number'
      || !Number.isFinite(ev.tStartMs)
      || ev.tStartMs < 0) malformed();
    const durationMs = ev.dDurationMs ?? 0;
    if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) {
      malformed();
    }
    let rawText = '';
    for (const segment of ev.segs) {
      if (!segment || typeof segment !== 'object' || typeof segment.utf8 !== 'string') malformed();
      rawText += segment.utf8;
      if (rawText.length > MAX_CUE_TEXT_CHARS) malformed();
    }
    const text = rawText.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const startSec = ev.tStartMs / 1000;
    const endSec = startSec + durationMs / 1000;
    if (!Number.isFinite(endSec) || endSec > durationSec) malformed();
    totalTextChars += text.length;
    if (totalTextChars > MAX_TOTAL_CUE_TEXT_CHARS) malformed();
    cues.push({ startSec, endSec, text });
  }
  return cues;
}

export function pickCaptionTrack(
  tracks: CaptionTrackInfo[],
  preferredLangs: string[],
): CaptionTrackInfo | null {
  const byLang = (list: CaptionTrackInfo[]): CaptionTrackInfo | null => {
    if (!list.length) return null;
    for (const lang of preferredLangs) {
      const prefix = lang.toLowerCase().split('-')[0];
      const hit = list.find(t => t.languageCode.toLowerCase().startsWith(prefix));
      if (hit) return hit;
    }
    return list[0];
  };
  const manual = tracks.filter(t => t.kind !== 'asr');
  const asr = tracks.filter(t => t.kind === 'asr');
  return byLang(manual) ?? byLang(asr);
}
