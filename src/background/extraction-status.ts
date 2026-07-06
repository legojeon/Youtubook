import type { ExtractionStatus } from '../messages';

export interface ExtractionStatusDeps {
  setBadgeText: (text: string) => void;
  notify: (id: string, title: string, message: string) => void;
}

export interface ExtractionController {
  onProgress(percent: number, stage: string, tabId: number): void;
  onEnded(): void;
  onCommitted(sessionId: string, title: string, message: string): void;
  getStatus(): ExtractionStatus;
  getTabId(): number;
}

/** SW-side extraction state + toolbar badge + completion notification. */
export function createExtractionController(deps: ExtractionStatusDeps): ExtractionController {
  let running = false;
  let percent = 0;
  let stage = '';
  let tabId = -1;
  return {
    onProgress(p, s, tid) {
      running = true; percent = p; stage = s; tabId = tid;
      deps.setBadgeText(`${p}%`);
    },
    onEnded() {
      running = false;
      deps.setBadgeText('');
    },
    onCommitted(sessionId, title, message) {
      running = false;
      deps.setBadgeText('✓');
      deps.notify(sessionId, title, message);
    },
    getStatus() { return { running, percent, stage }; },
    getTabId() { return tabId; },
  };
}
