import type { ObservedTimedtextUrl, TimedtextQuery } from '../core/timedtext';
import { TimedtextUrlCache } from '../core/timedtext';
import { MAX_PENDING_TIMEDTEXT_WAITERS } from '../core/limits';

const WAIT_TIMEOUT_MS = 6_000;

type Reply = (entry: ObservedTimedtextUrl | null) => void;

interface PendingWaiter {
  query: TimedtextQuery;
  reply: Reply;
  timer: ReturnType<typeof setTimeout>;
}

export class TimedtextWaiterMap {
  private nextId = 0;
  private readonly pending = new Map<number, PendingWaiter>();

  constructor(
    private readonly cache: TimedtextUrlCache,
    private readonly maxPending = MAX_PENDING_TIMEDTEXT_WAITERS,
  ) {}

  get size(): number {
    return this.pending.size;
  }

  wait(query: TimedtextQuery, reply: Reply): void {
    const cached = this.cache.find(query);
    if (cached) {
      reply(cached);
      return;
    }
    if (this.pending.size >= this.maxPending) {
      reply(null);
      return;
    }

    const id = ++this.nextId;
    const timer = setTimeout(() => this.finish(id, null), WAIT_TIMEOUT_MS);
    this.pending.set(id, { query, reply, timer });
  }

  resolveMatches(): void {
    for (const [id, waiter] of this.pending) {
      const match = this.cache.find(waiter.query);
      if (match) this.finish(id, match);
    }
  }

  clear(): void {
    for (const id of [...this.pending.keys()]) {
      this.finish(id, null);
    }
  }

  private finish(id: number, entry: ObservedTimedtextUrl | null): void {
    const waiter = this.pending.get(id);
    if (!waiter) return;

    clearTimeout(waiter.timer);
    this.pending.delete(id);
    waiter.reply(entry);
  }
}
