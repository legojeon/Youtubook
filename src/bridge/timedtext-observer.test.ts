import { describe, expect, it, vi } from 'vitest';
import { observeResourceUrls } from './timedtext-observer';

describe('observeResourceUrls', () => {
  it('forwards buffered resource entries and disconnects when stopped', () => {
    const onEntry = vi.fn();
    const observe = vi.fn();
    const disconnect = vi.fn();
    let callback: PerformanceObserverCallback | undefined;
    const factory = vi.fn((next: PerformanceObserverCallback) => {
      callback = next;
      return { observe, disconnect };
    });

    const stop = observeResourceUrls(onEntry, factory);
    const entries = [
      { name: 'https://www.youtube.com/api/timedtext?v=one', startTime: 12 },
      { name: 'https://www.youtube.com/api/timedtext?v=two', startTime: 34 },
    ] as PerformanceResourceTiming[];
    const entryList: PerformanceObserverEntryList = {
      getEntries: () => entries,
      getEntriesByName: () => [],
      getEntriesByType: () => [],
    };
    callback?.(entryList, {} as PerformanceObserver);

    expect(factory).toHaveBeenCalledOnce();
    expect(observe).toHaveBeenCalledWith({ type: 'resource', buffered: true });
    expect(onEntry).toHaveBeenNthCalledWith(1, entries[0].name, entries[0].startTime);
    expect(onEntry).toHaveBeenNthCalledWith(2, entries[1].name, entries[1].startTime);

    stop();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
