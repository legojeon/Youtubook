import { describe, expect, it } from 'vitest';
import { popupView } from './popup-view';

describe('popupView', () => {
  it('running → cancel mode, enabled, progress status', () => {
    expect(popupView({ running: true, percent: 42, stage: 'stage_scan' }, true)).toEqual({
      mode: 'cancel',
      disabled: false,
      status: { kind: 'progress', stageKey: 'stage_scan', percent: 42 },
    });
  });

  it('idle on a youtube watch page → generate mode, enabled, no status', () => {
    expect(popupView({ running: false, percent: 0, stage: '' }, true)).toEqual({
      mode: 'generate',
      disabled: false,
      status: { kind: 'none' },
    });
  });

  it('idle off a youtube page → generate mode, disabled, notYoutube status', () => {
    expect(popupView(null, false)).toEqual({
      mode: 'generate',
      disabled: true,
      status: { kind: 'notYoutube' },
    });
  });

  it('running takes precedence even off a youtube page', () => {
    expect(popupView({ running: true, percent: 10, stage: 'stage_capture' }, false).mode).toBe('cancel');
  });
});
