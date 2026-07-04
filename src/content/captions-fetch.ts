import {
  parseJson3,
  pickCaptionTrack,
  type CaptionFetchResult,
  type CaptionTrackInfo,
} from '../core/captions';
import type { Cue } from '../core/types';
import {
  toJson3TimedtextUrl,
  type ObservedTimedtextUrl,
  type TimedtextQuery,
} from '../core/timedtext';
import { getTimedtextUrl, waitForTimedtextUrl } from './bridge-client';

interface TextResponse {
  ok: boolean;
  text: string;
}

type SubtitleButton = Pick<HTMLButtonElement, 'getAttribute' | 'click'>;

export interface CaptionFetchDeps {
  requestText(url: string): Promise<TextResponse>;
  getObserved(query: TimedtextQuery): Promise<ObservedTimedtextUrl | null>;
  waitObserved(query: TimedtextQuery): Promise<ObservedTimedtextUrl | null>;
  getSubtitleButton(): SubtitleButton | null;
  nextTurn(): Promise<void>;
  preferredLanguages: readonly string[];
}

type Json3FetchResult =
  | { status: 'available'; cues: Cue[] }
  | { status: 'empty' }
  | { status: 'non-ok' }
  | { status: 'parse-error' }
  | { status: 'too-many-events' };

type ObservedFetchResult = Json3FetchResult | { status: 'invalid-url' };

async function fetchJson3(url: string, requestText: CaptionFetchDeps['requestText']):
Promise<Json3FetchResult> {
  let response: TextResponse;
  try {
    response = await requestText(url);
  } catch {
    return { status: 'non-ok' };
  }
  if (!response.ok) return { status: 'non-ok' };
  if (!response.text) return { status: 'empty' };

  try {
    const cues = parseJson3(JSON.parse(response.text));
    return cues.length ? { status: 'available', cues } : { status: 'empty' };
  } catch (error) {
    if (error instanceof Error && error.message === 'too-many-events') {
      return { status: 'too-many-events' };
    }
    return { status: 'parse-error' };
  }
}

function directJson3Url(baseUrl: string): string {
  return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}fmt=json3`;
}

function failed(reason: Exclude<CaptionFetchResult, { status: 'available' | 'absent' }>['reason']):
CaptionFetchResult {
  return { status: 'fetch-failed', reason, cues: [] };
}

function observedFetchFailure(result: Exclude<ObservedFetchResult, { status: 'available' }>):
CaptionFetchResult {
  if (result.status === 'invalid-url') return failed('invalid-url');
  if (result.status === 'too-many-events') return failed('too-many-events');
  if (result.status === 'parse-error') return failed('parse-error');
  return failed('direct-empty');
}

async function fetchObservedJson3(
  observed: ObservedTimedtextUrl,
  videoId: string,
  deps: CaptionFetchDeps,
): Promise<ObservedFetchResult> {
  const url = toJson3TimedtextUrl(observed.url, videoId);
  if (!url) return { status: 'invalid-url' };
  return fetchJson3(url, deps.requestText);
}

function observedFetchResult(result: ObservedFetchResult): CaptionFetchResult {
  return result.status === 'available' ? result : observedFetchFailure(result);
}

const browserDeps: CaptionFetchDeps = {
  async requestText(url) {
    const response = await fetch(url);
    return { ok: response.ok, text: await response.text() };
  },
  getObserved: getTimedtextUrl,
  waitObserved: waitForTimedtextUrl,
  getSubtitleButton: () => document.querySelector<HTMLButtonElement>('.ytp-subtitles-button'),
  nextTurn: () => new Promise(resolve => setTimeout(resolve, 0)),
  preferredLanguages: navigator.languages,
};

export async function fetchCaptions(
  tracks: CaptionTrackInfo[],
  videoId: string,
  deps: CaptionFetchDeps = browserDeps,
): Promise<CaptionFetchResult> {
  const track = pickCaptionTrack(tracks, [...deps.preferredLanguages]);
  if (!track) return { status: 'absent', cues: [] };

  const direct = await fetchJson3(directJson3Url(track.baseUrl), deps.requestText);
  if (direct.status === 'available') return direct;
  if (direct.status === 'too-many-events') return failed('too-many-events');

  const query: TimedtextQuery = {
    videoId,
    languageCode: track.languageCode,
    kind: track.kind,
  };
  let prior: ObservedTimedtextUrl | null;
  try {
    prior = await deps.getObserved(query);
  } catch {
    return failed('no-observed-url');
  }
  if (prior) {
    const priorResult = await fetchObservedJson3(prior, videoId, deps);
    if (priorResult.status === 'available') return priorResult;
    if (
      priorResult.status === 'invalid-url' ||
      priorResult.status === 'too-many-events' ||
      priorResult.status === 'parse-error'
    ) {
      return observedFetchResult(priorResult);
    }
  }

  const button = deps.getSubtitleButton();
  if (!button || button.getAttribute('aria-disabled') === 'true') {
    return failed('no-observed-url');
  }

  const wasOn = button.getAttribute('aria-pressed') === 'true';
  const cutoff = performance.now();
  try {
    if (wasOn) {
      button.click();
      await deps.nextTurn();
      button.click();
    } else {
      button.click();
    }

    let fresh: ObservedTimedtextUrl | null;
    try {
      fresh = await deps.waitObserved({ ...query, afterStartTime: cutoff });
    } catch {
      return failed('player-timeout');
    }
    if (!fresh) return failed('player-timeout');
    return observedFetchResult(await fetchObservedJson3(fresh, videoId, deps));
  } catch {
    return failed('player-timeout');
  } finally {
    const isOn = button.getAttribute('aria-pressed') === 'true';
    if (isOn !== wasOn) button.click();
  }
}
