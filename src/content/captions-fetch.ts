import { parseJson3, pickCaptionTrack, type CaptionTrackInfo } from '../core/captions';
import type { Cue } from '../core/types';

/** 자막이 없거나 가져오기 실패하면 null (이미지 전용 모드). */
export async function fetchCaptions(tracks: CaptionTrackInfo[]): Promise<Cue[] | null> {
  const track = pickCaptionTrack(tracks, [...navigator.languages]);
  if (!track) return null;
  try {
    const sep = track.baseUrl.includes('?') ? '&' : '?';
    const res = await fetch(`${track.baseUrl}${sep}fmt=json3`);
    if (!res.ok) return null;
    const cues = parseJson3(await res.json());
    return cues.length ? cues : null;
  } catch {
    return null;
  }
}
