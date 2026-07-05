import type { Msg, MsgResponse } from '../messages';
import { isHandledBackgroundMessage } from './message-routing';
import { openOrFocusResults } from './results-tab';
import { createSessionMessageHandler } from './session-protocol';

const resultsUrl = chrome.runtime.getURL('src/results/results.html');
const handle = createSessionMessageHandler({
  now: Date.now,
  resultsUrl,
  openOrFocusResults: sessionId => openOrFocusResults(sessionId, resultsUrl, {
    query: queryInfo => chrome.tabs.query(queryInfo),
    updateTab: (tabId, updateProperties) => chrome.tabs.update(tabId, updateProperties),
    focusWindow: (windowId, updateInfo) => chrome.windows.update(windowId, updateInfo),
    createTab: createProperties => chrome.tabs.create(createProperties),
  }),
  broadcast: message => chrome.runtime.sendMessage(message).then(() => {}),
  sendToTab: async (tabId, message) => chrome.tabs.sendMessage<Msg, MsgResponse>(tabId, message),
});

chrome.runtime.onMessage.addListener(
  (msg: unknown, sender, sendResponse: (response: MsgResponse) => void) => {
    if (!isHandledBackgroundMessage(msg)) return false;
    void handle(msg, sender).then(sendResponse);
    return true;
  },
);
