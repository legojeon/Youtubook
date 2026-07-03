import { parseJson3, pickCaptionTrack, type CaptionTrackInfo } from '../core/captions';
import type { Cue } from '../core/types';

async function fetchJson3(url: string): Promise<Cue[] | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const text = await res.text();
    // POT(proof-of-origin) 토큰이 없는 timedtext 요청은 200 + 빈 본문으로 온다
    if (!text) return null;
    const cues = parseJson3(JSON.parse(text));
    return cues.length ? cues : null;
  } catch {
    return null;
  }
}

function timedtextUrls(sinceMs: number, requirePot: boolean): string[] {
  return performance
    .getEntriesByType('resource')
    .filter(e => e.name.includes('/api/timedtext') && e.startTime > sinceMs)
    .map(e => e.name)
    .filter(u => !requirePot || u.includes('pot='));
}

/**
 * 플레이어가 직접 보낸 자막 요청(POT 포함)을 재활용한다.
 * CC 버튼을 잠깐 켜 플레이어의 timedtext 요청을 유도하고, Resource Timing에서
 * 그 URL을 찾아 그대로 재요청한다. 이 경로는 플레이어의 기본 트랙을 따른다.
 */
async function fetchViaPlayerRequest(): Promise<Cue[] | null> {
  // 이미 발생한 요청(사용자가 CC를 켠 적 있음) 재활용.
  // requirePot=true — 우리가 보낸 POT 없는 실패 요청은 제외한다.
  const prior = timedtextUrls(0, true);
  if (prior.length) {
    const cues = await fetchJson3(prior[prior.length - 1]);
    if (cues) return cues;
  }

  const btn = document.querySelector<HTMLButtonElement>('.ytp-subtitles-button');
  if (!btn || btn.getAttribute('aria-disabled') === 'true') return null;
  const wasOn = btn.getAttribute('aria-pressed') === 'true';
  const mark = performance.now();
  if (!wasOn) btn.click();
  try {
    for (let waited = 0; waited < 6000; waited += 250) {
      const fresh = timedtextUrls(mark, false);
      if (fresh.length) return await fetchJson3(fresh[fresh.length - 1]);
      await new Promise(r => setTimeout(r, 250));
    }
    return null;
  } finally {
    if (!wasOn) btn.click(); // CC 원상 복구
  }
}

/** 자막이 없거나 가져오기 실패하면 null (이미지 전용 모드). */
export async function fetchCaptions(tracks: CaptionTrackInfo[]): Promise<Cue[] | null> {
  const track = pickCaptionTrack(tracks, [...navigator.languages]);
  if (!track) return null;
  const sep = track.baseUrl.includes('?') ? '&' : '?';
  const direct = await fetchJson3(`${track.baseUrl}${sep}fmt=json3`);
  if (direct) return direct;
  console.warn('[youtubook] 자막 직접 요청 실패(빈 응답) — 플레이어 요청 재활용 폴백 시도');
  return fetchViaPlayerRequest();
}
