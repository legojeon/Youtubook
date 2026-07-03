import type { Cue } from './types';

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
