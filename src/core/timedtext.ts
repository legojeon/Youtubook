export interface TimedtextQuery {
  videoId: string;
  languageCode?: string;
  kind?: string;
  afterStartTime?: number;
}

export interface ObservedTimedtextUrl {
  url: string;
  videoId: string;
  languageCode?: string;
  kind?: string;
  startTime: number;
}

function parseTimedtextUrl(raw: string, startTime: number): ObservedTimedtextUrl | null {
  try {
    const url = new URL(raw);
    const videoIds = url.searchParams.getAll('v');
    const pots = url.searchParams.getAll('pot');
    const videoId = videoIds[0];
    const pot = pots[0];
    if (
      url.origin !== 'https://www.youtube.com' ||
      url.pathname !== '/api/timedtext' ||
      url.username !== '' ||
      url.password !== '' ||
      videoIds.length !== 1 ||
      pots.length !== 1 ||
      !videoId ||
      !pot
    ) {
      return null;
    }

    return {
      url: url.toString(),
      videoId,
      languageCode: url.searchParams.get('lang') ?? undefined,
      kind: url.searchParams.get('kind') ?? undefined,
      startTime,
    };
  } catch {
    return null;
  }
}

export class TimedtextUrlCache {
  private entries: ObservedTimedtextUrl[] = [];

  constructor(private readonly maxPerVideo: number) {}

  get size(): number {
    return this.entries.length;
  }

  sizeForVideo(videoId: string): number {
    return this.entries.filter(entry => entry.videoId === videoId).length;
  }

  clear(): void {
    this.entries = [];
  }

  add(raw: string, startTime: number): boolean {
    const next = parseTimedtextUrl(raw, startTime);
    if (!next) return false;

    this.entries = this.entries.filter(entry => entry.url !== next.url);
    this.entries.push(next);

    const entriesForVideo = this.entries.filter(entry => entry.videoId === next.videoId);
    const excess = entriesForVideo.length - this.maxPerVideo;
    if (excess > 0) {
      const removed = new Set(entriesForVideo.slice(0, excess));
      this.entries = this.entries.filter(entry => !removed.has(entry));
    }

    return true;
  }

  find(query: TimedtextQuery): ObservedTimedtextUrl | null {
    const afterStartTime = query.afterStartTime ?? -1;
    const score = (entry: ObservedTimedtextUrl) =>
      Number((entry.languageCode ?? '') === (query.languageCode ?? '')) * 2 +
      Number((entry.kind ?? '') === (query.kind ?? ''));

    return this.entries
      .filter(entry => entry.videoId === query.videoId && entry.startTime > afterStartTime)
      .sort((a, b) => score(b) - score(a) || b.startTime - a.startTime)[0] ?? null;
  }
}

export function toJson3TimedtextUrl(raw: string, videoId: string): string | null {
  const parsed = parseTimedtextUrl(raw, 0);
  if (!parsed || parsed.videoId !== videoId) return null;

  const url = new URL(parsed.url);
  url.searchParams.set('fmt', 'json3');
  return url.toString();
}
