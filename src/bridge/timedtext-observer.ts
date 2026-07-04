type ResourceObserver = Pick<PerformanceObserver, 'observe' | 'disconnect'>;

export type ResourceObserverFactory = (
  callback: PerformanceObserverCallback,
) => ResourceObserver;

export function observeResourceUrls(
  onEntry: (name: string, startTime: number) => void,
  factory: ResourceObserverFactory = callback => new PerformanceObserver(callback),
): () => void {
  const observer = factory(list => {
    for (const entry of list.getEntries()) {
      onEntry(entry.name, entry.startTime);
    }
  });
  observer.observe({ type: 'resource', buffered: true });
  return () => observer.disconnect();
}
