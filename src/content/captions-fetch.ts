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
  requestText(url: string, signal?: AbortSignal): Promise<TextResponse>;
  getObserved(query: TimedtextQuery, signal?: AbortSignal): Promise<ObservedTimedtextUrl | null>;
  waitObserved(query: TimedtextQuery, signal?: AbortSignal): Promise<ObservedTimedtextUrl | null>;
  getSubtitleButton(): SubtitleButton | null;
  now(): number;
  waitForPressed(
    button: SubtitleButton,
    expected: boolean,
    signal?: AbortSignal,
  ): Promise<boolean>;
  preferredLanguages: readonly string[];
}

type Json3FetchResult =
  | { status: 'available'; cues: Cue[] }
  | { status: 'empty' }
  | { status: 'non-ok' }
  | { status: 'parse-error' }
  | { status: 'too-many-events' };

type ObservedFetchResult = Json3FetchResult | { status: 'invalid-url' };

function rethrowAbort(error: unknown): void {
  if (error instanceof Error && error.name === 'AbortError') throw error;
}

async function fetchJson3(
  url: string,
  requestText: CaptionFetchDeps['requestText'],
  signal?: AbortSignal,
  durationSec?: number,
):
Promise<Json3FetchResult> {
  let response: TextResponse;
  try {
    response = signal ? await requestText(url, signal) : await requestText(url);
  } catch (error) {
    rethrowAbort(error);
    return { status: 'non-ok' };
  }
  if (!response.ok) return { status: 'non-ok' };
  if (!response.text) return { status: 'empty' };

  try {
    const cues = parseJson3(JSON.parse(response.text), durationSec);
    return cues.length ? { status: 'available', cues } : { status: 'empty' };
  } catch (error) {
    if (error instanceof Error && error.message === 'too-many-events') {
      return { status: 'too-many-events' };
    }
    return { status: 'parse-error' };
  }
}

function directJson3Url(baseUrl: string, videoId: string): string | null {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return null;
  }

  if (
    url.protocol !== 'https:'
    || url.hostname !== 'www.youtube.com'
    || url.pathname !== '/api/timedtext'
    || url.username
    || url.password
  ) {
    return null;
  }

  const videoIds = url.searchParams.getAll('v');
  if (videoIds.length !== 1 || videoIds[0] !== videoId) return null;

  url.searchParams.delete('fmt');
  url.searchParams.set('fmt', 'json3');
  return url.toString();
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
  signal?: AbortSignal,
  durationSec?: number,
): Promise<ObservedFetchResult> {
  const url = toJson3TimedtextUrl(observed.url, videoId);
  if (!url) return { status: 'invalid-url' };
  return fetchJson3(url, deps.requestText, signal, durationSec);
}

function observedFetchResult(result: ObservedFetchResult): CaptionFetchResult {
  return result.status === 'available' ? result : observedFetchFailure(result);
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(new DOMException('사용자가 취소했습니다', 'AbortError'));
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function waitForBrowserPressed(
  button: SubtitleButton,
  expected: boolean,
  signal?: AbortSignal,
): Promise<boolean> {
  signal?.throwIfAborted();
  const expectedValue = String(expected);
  if (button.getAttribute('aria-pressed') === expectedValue) return true;
  for (let elapsed = 25; elapsed <= 500; elapsed += 25) {
    await wait(25, signal);
    if (button.getAttribute('aria-pressed') === expectedValue) return true;
  }
  return false;
}

const browserDeps: CaptionFetchDeps = {
  async requestText(url, signal) {
    const response = await fetch(url, { signal });
    return { ok: response.ok, text: await response.text() };
  },
  getObserved: getTimedtextUrl,
  waitObserved: waitForTimedtextUrl,
  getSubtitleButton: () => document.querySelector<HTMLButtonElement>('.ytp-subtitles-button'),
  now: () => performance.now(),
  waitForPressed: waitForBrowserPressed,
  preferredLanguages: navigator.languages,
};

async function transitionButton(
  button: SubtitleButton,
  expected: boolean,
  deps: CaptionFetchDeps,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    signal?.throwIfAborted();
    button.click();
    return await deps.waitForPressed(button, expected, signal);
  } catch (error) {
    rethrowAbort(error);
    return false;
  }
}

export async function fetchCaptions(
  tracks: CaptionTrackInfo[],
  videoId: string,
  signalOrDeps: AbortSignal | CaptionFetchDeps = browserDeps,
  depsOverride?: CaptionFetchDeps,
  durationSec?: number,
): Promise<CaptionFetchResult> {
  const hasSignal = 'aborted' in signalOrDeps;
  const signal = hasSignal ? signalOrDeps as AbortSignal : undefined;
  const deps = hasSignal ? depsOverride ?? browserDeps : signalOrDeps as CaptionFetchDeps;
  signal?.throwIfAborted();
  const track = pickCaptionTrack(tracks, [...deps.preferredLanguages]);
  if (!track) return { status: 'absent', cues: [] };

  const directUrl = directJson3Url(track.baseUrl, videoId);
  let hasValidFallbackUrl = directUrl !== null;
  let lastParseFailure: CaptionFetchResult | null = null;
  if (directUrl) {
    const direct = await fetchJson3(directUrl, deps.requestText, signal, durationSec);
    if (direct.status === 'available') return direct;
    if (direct.status === 'too-many-events') return failed('too-many-events');
    if (direct.status === 'parse-error') lastParseFailure = failed('parse-error');
  }

  const query: TimedtextQuery = {
    videoId,
    languageCode: track.languageCode,
    kind: track.kind,
  };
  const lookupStartedAt = deps.now();
  let prior: ObservedTimedtextUrl | null = null;
  try {
    prior = signal ? await deps.getObserved(query, signal) : await deps.getObserved(query);
  } catch (error) {
    rethrowAbort(error);
    // A failed cache lookup does not prevent the player from producing a fresh URL.
  }
  const cutoff = prior?.startTime ?? lookupStartedAt;
  if (prior) {
    const priorResult = await fetchObservedJson3(prior, videoId, deps, signal, durationSec);
    if (priorResult.status === 'available') return priorResult;
    if (priorResult.status === 'too-many-events') {
      return observedFetchResult(priorResult);
    }
    if (priorResult.status === 'parse-error') lastParseFailure = failed('parse-error');
    if (priorResult.status !== 'invalid-url') hasValidFallbackUrl = true;
  }

  const button = deps.getSubtitleButton();
  if (!button || button.getAttribute('aria-disabled') === 'true') {
    if (lastParseFailure) return lastParseFailure;
    return failed(hasValidFallbackUrl ? 'no-observed-url' : 'invalid-url');
  }

  const wasOn = button.getAttribute('aria-pressed') === 'true';
  let result: CaptionFetchResult = failed('player-timeout');
  try {
    let transitioned: boolean;
    if (wasOn) {
      transitioned = await transitionButton(button, false, deps, signal);
      if (transitioned) transitioned = await transitionButton(button, true, deps, signal);
    } else {
      transitioned = await transitionButton(button, true, deps, signal);
    }

    if (transitioned) {
      let fresh: ObservedTimedtextUrl | null = null;
      try {
        const freshQuery = { ...query, afterStartTime: cutoff };
        fresh = signal
          ? await deps.waitObserved(freshQuery, signal)
          : await deps.waitObserved(freshQuery);
      } catch (error) {
        rethrowAbort(error);
        // A bridge timeout is reported after restoring the original CC state.
      }
      if (fresh) {
        result = observedFetchResult(await fetchObservedJson3(
          fresh,
          videoId,
          deps,
          signal,
          durationSec,
        ));
      }
    }
  } catch (error) {
    rethrowAbort(error);
    result = failed('player-timeout');
  } finally {
    const isOn = button.getAttribute('aria-pressed') === 'true';
    if (isOn !== wasOn) {
      const restored = await transitionButton(button, wasOn, deps);
      if (!restored) result = failed('player-timeout');
    }
  }
  if (result.status === 'available'
    || (result.status === 'fetch-failed' && result.reason === 'too-many-events')) return result;
  return lastParseFailure ?? result;
}
