export interface ResultsTabDeps {
  query: (queryInfo: chrome.tabs.QueryInfo) => Promise<chrome.tabs.Tab[]>;
  updateTab: (tabId: number, updateProperties: chrome.tabs.UpdateProperties) => Promise<chrome.tabs.Tab>;
  focusWindow: (
    windowId: number,
    updateInfo: chrome.windows.UpdateInfo,
  ) => Promise<chrome.windows.Window>;
  createTab: (createProperties: chrome.tabs.CreateProperties) => Promise<chrome.tabs.Tab>;
}

const inFlight = new Map<string, Promise<void>>();

export async function openOrFocusResults(
  sessionId: string,
  resultsUrl: string,
  deps: ResultsTabDeps,
): Promise<void> {
  const url = `${resultsUrl}?session=${encodeURIComponent(sessionId)}`;
  const active = inFlight.get(url);
  if (active) return active;

  const operation = (async () => {
    const existing = (await deps.query({ url: `${resultsUrl}?session=*` }))
      .find(tab => tab.url === url);
    if (existing?.id !== undefined) {
      await deps.updateTab(existing.id, { active: true });
      if (existing.windowId !== undefined) {
        await deps.focusWindow(existing.windowId, { focused: true });
      }
      return;
    }
    await deps.createTab({ url });
  })();
  inFlight.set(url, operation);
  try {
    await operation;
  } finally {
    if (inFlight.get(url) === operation) inFlight.delete(url);
  }
}
