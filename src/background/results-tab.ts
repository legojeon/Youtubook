export interface ResultsTabDeps {
  query: (queryInfo: chrome.tabs.QueryInfo) => Promise<chrome.tabs.Tab[]>;
  updateTab: (tabId: number, updateProperties: chrome.tabs.UpdateProperties) => Promise<chrome.tabs.Tab>;
  focusWindow: (
    windowId: number,
    updateInfo: chrome.windows.UpdateInfo,
  ) => Promise<chrome.windows.Window>;
  createTab: (createProperties: chrome.tabs.CreateProperties) => Promise<chrome.tabs.Tab>;
}

export async function openOrFocusResults(
  sessionId: string,
  resultsUrl: string,
  deps: ResultsTabDeps,
): Promise<void> {
  const url = `${resultsUrl}?session=${encodeURIComponent(sessionId)}`;
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
}
