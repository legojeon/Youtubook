import type { Cue } from './types';

export const MAX_CAPTION_EVENTS = 100_000;

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

export function parseJson3(raw: unknown): Cue[] {
  const events = (raw as { events?: Json3Event[] } | null)?.events;
  if (!Array.isArray(events)) return [];
  if (events.length > MAX_CAPTION_EVENTS) throw new Error('too-many-events');
  const cues: Cue[] = [];
  for (const ev of events) {
    if (!ev || !Array.isArray(ev.segs) || ev.tStartMs == null || ev.aAppend === 1) continue;
    const text = ev.segs.map(s => s.utf8 ?? '').join('').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const startSec = ev.tStartMs / 1000;
    cues.push({ startSec, endSec: startSec + (ev.dDurationMs ?? 0) / 1000, text });
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
