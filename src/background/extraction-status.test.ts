import { describe, expect, it, vi } from 'vitest';
import { createExtractionController } from './extraction-status';

const mkDeps = () => ({ setBadgeText: vi.fn(), notify: vi.fn() });

describe('createExtractionController', () => {
  it('tracks progress and shows the badge percent', () => {
    const deps = mkDeps();
    const c = createExtractionController(deps);
    c.onProgress(42, 'stage_scan', 9);
    expect(deps.setBadgeText).toHaveBeenLastCalledWith('42%');
    expect(c.getStatus()).toEqual({ running: true, percent: 42, stage: 'stage_scan' });
    expect(c.getTabId()).toBe(9);
  });

  it('clears badge + running on ended', () => {
    const deps = mkDeps();
    const c = createExtractionController(deps);
    c.onProgress(50, 'stage_capture', 1);
    c.onEnded();
    expect(deps.setBadgeText).toHaveBeenLastCalledWith('');
    expect(c.getStatus().running).toBe(false);
  });

  it('shows a check badge and fires a notification on commit', () => {
    const deps = mkDeps();
    const c = createExtractionController(deps);
    c.onProgress(90, 'stage_capture', 1);
    c.onCommitted('sess-1', 'Picture book ready', 'Done.');
    expect(deps.setBadgeText).toHaveBeenLastCalledWith('✓');
    expect(deps.notify).toHaveBeenCalledWith('sess-1', 'Picture book ready', 'Done.');
    expect(c.getStatus().running).toBe(false);
  });
});
