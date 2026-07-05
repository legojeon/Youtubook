import { describe, expect, it, vi } from 'vitest';
import { openOrFocusResults } from './results-tab';

const resultsUrl = 'chrome-extension://test/src/results/results.html';

describe('openOrFocusResults', () => {
  it('focuses the exact existing session tab instead of creating a duplicate', async () => {
    const query = vi.fn(async () => [
      { id: 3, windowId: 4, url: `${resultsUrl}?session=other` } as chrome.tabs.Tab,
      { id: 7, windowId: 8, url: `${resultsUrl}?session=session-1` } as chrome.tabs.Tab,
    ]);
    const updateTab = vi.fn(async () => ({} as chrome.tabs.Tab));
    const focusWindow = vi.fn(async () => ({} as chrome.windows.Window));
    const createTab = vi.fn(async () => ({} as chrome.tabs.Tab));

    await openOrFocusResults('session-1', resultsUrl, {
      query, updateTab, focusWindow, createTab,
    });

    expect(query).toHaveBeenCalledWith({ url: `${resultsUrl}?session=*` });
    expect(updateTab).toHaveBeenCalledWith(7, { active: true });
    expect(focusWindow).toHaveBeenCalledWith(8, { focused: true });
    expect(createTab).not.toHaveBeenCalled();
  });

  it('creates the exact encoded session URL when no tab matches', async () => {
    const createTab = vi.fn(async () => ({} as chrome.tabs.Tab));

    await openOrFocusResults('session / 1', resultsUrl, {
      query: async () => [],
      updateTab: async () => ({} as chrome.tabs.Tab),
      focusWindow: async () => ({} as chrome.windows.Window),
      createTab,
    });

    expect(createTab).toHaveBeenCalledWith({
      url: `${resultsUrl}?session=session%20%2F%201`,
    });
  });

  it('coalesces concurrent opens for the same session within one worker', async () => {
    let releaseCreate!: () => void;
    const createGate = new Promise<void>(resolve => { releaseCreate = resolve; });
    let signalCreate!: () => void;
    const createStarted = new Promise<void>(resolve => { signalCreate = resolve; });
    const createTab = vi.fn(async () => {
      signalCreate();
      await createGate;
      return {} as chrome.tabs.Tab;
    });
    const dependencies = {
      query: async () => [],
      updateTab: async () => ({} as chrome.tabs.Tab),
      focusWindow: async () => ({} as chrome.windows.Window),
      createTab,
    };

    const first = openOrFocusResults('session-1', resultsUrl, dependencies);
    await createStarted;
    const second = openOrFocusResults('session-1', resultsUrl, dependencies);
    await Promise.resolve();

    expect(createTab).toHaveBeenCalledOnce();
    releaseCreate();
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
  });
});
