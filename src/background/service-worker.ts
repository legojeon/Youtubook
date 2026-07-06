import type { ExtractionStatus, Msg, MsgResponse } from '../messages';
import { createExtractionController } from './extraction-status';
import { isHandledBackgroundMessage } from './message-routing';
import { openOrFocusResults } from './results-tab';
import { createSessionMessageHandler } from './session-protocol';
import { t } from '../ui/i18n';

const resultsUrl = chrome.runtime.getURL('src/results/results.html');

const tabDeps = {
  query: (queryInfo: chrome.tabs.QueryInfo) => chrome.tabs.query(queryInfo),
  updateTab: (tabId: number, props: chrome.tabs.UpdateProperties) => chrome.tabs.update(tabId, props),
  focusWindow: (windowId: number, info: chrome.windows.UpdateInfo) => chrome.windows.update(windowId, info),
  createTab: (props: chrome.tabs.CreateProperties) => chrome.tabs.create(props),
};

const extraction = createExtractionController({
  setBadgeText: text => { void chrome.action.setBadgeText({ text }); },
  notify: (id, title, message) => {
    void chrome.notifications.create(id, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title,
      message,
    });
  },
});
void chrome.action.setBadgeBackgroundColor({ color: '#e60023' });

const handle = createSessionMessageHandler({
  now: Date.now,
  resultsUrl,
  // Commit: open results quietly in the background, mark done (badge ✓ + notification).
  openOrFocusResults: async sessionId => {
    await openOrFocusResults(sessionId, resultsUrl, tabDeps, true);
    extraction.onCommitted(sessionId, t('notify_doneTitle'), t('notify_doneBody'));
  },
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

// Extraction status/control messages (separate from the session protocol).
chrome.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Msg;
  switch (m.type) {
    case 'EXTRACTION_PROGRESS':
      extraction.onProgress(m.percent, m.stage, sender.tab?.id ?? -1);
      return false;
    case 'EXTRACTION_ENDED':
      extraction.onEnded();
      return false;
    case 'GET_EXTRACTION_STATUS': {
      const statusResponse: ExtractionStatus = extraction.getStatus();
      sendResponse(statusResponse);
      return true;
    }
    case 'CANCEL_EXTRACTION': {
      const tabId = extraction.getTabId();
      if (tabId >= 0) {
        chrome.tabs.sendMessage(tabId, { type: 'CANCEL_EXTRACTION' } as Msg)
          .catch(() => extraction.onEnded()); // tab gone/unreachable → converge anyway
      } else {
        extraction.onEnded(); // nothing reachable to cancel — clear any stale state
      }
      sendResponse({ ok: true });
      return true;
    }
    default:
      return false;
  }
});

// Clicking the completion notification focuses the results tab (notificationId === sessionId).
chrome.notifications.onClicked.addListener(sessionId => {
  void openOrFocusResults(sessionId, resultsUrl, tabDeps, false);
});

// If the source tab closes mid-extraction, its content script dies without
// sending EXTRACTION_ENDED — clear the badge/status so it doesn't strand.
chrome.tabs.onRemoved.addListener(tabId => {
  if (tabId === extraction.getTabId()) extraction.onEnded();
});
