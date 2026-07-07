import type { ExtractionStatus } from '../messages';

export type PopupMode = 'generate' | 'cancel';

export interface PopupView {
  mode: PopupMode;
  disabled: boolean;
  status:
    | { kind: 'progress'; stageKey: string; percent: number }
    | { kind: 'notYoutube' }
    | { kind: 'none' };
}

/**
 * Button/status state when the popup opens, derived from the service worker's
 * extraction status. Running → the single button is a "cancel" action; idle →
 * a "generate" action (disabled off a YouTube watch page). Pure/testable.
 */
export function popupView(status: ExtractionStatus | null, onYoutube: boolean): PopupView {
  if (status?.running) {
    return {
      mode: 'cancel',
      disabled: false,
      status: { kind: 'progress', stageKey: status.stage, percent: status.percent },
    };
  }
  return {
    mode: 'generate',
    disabled: !onYoutube,
    status: onYoutube ? { kind: 'none' } : { kind: 'notYoutube' },
  };
}
