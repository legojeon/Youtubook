import type { Msg, MsgResponse } from '../messages';
import { createSessionMessageHandler } from './session-protocol';

const resultsUrl = chrome.runtime.getURL('src/results/results.html');
const handle = createSessionMessageHandler({
  now: Date.now,
  resultsUrl,
  openResults: async sessionId => {
    await chrome.tabs.create({ url: `${resultsUrl}?session=${encodeURIComponent(sessionId)}` });
  },
  sendToTab: async (tabId, message) => chrome.tabs.sendMessage<Msg, MsgResponse>(tabId, message),
});

const HANDLED = new Set<Msg['type']>([
  'SESSION_BEGIN', 'SESSION_THUMBS_CHUNK', 'SESSION_IMAGE', 'SESSION_COMMIT',
  'REQUEST_CAPTURES', 'FRAME_READY',
]);

chrome.runtime.onMessage.addListener(
  (msg: Msg, sender, sendResponse: (response: MsgResponse) => void) => {
    if (!HANDLED.has(msg.type)) return false;
    void handle(msg, sender).then(sendResponse);
    return true;
  },
);
