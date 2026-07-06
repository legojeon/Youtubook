import { describe, expect, it, vi } from 'vitest';
import { createProgressReporter } from './progress-reporter';

describe('createProgressReporter', () => {
  it('sends the first report immediately, then throttles within the interval', () => {
    const send = vi.fn();
    let now = 1000;
    const r = createProgressReporter(send, () => now, 1000);
    r.report(10, 'stage_scan');           // first: elapsed is Infinity -> send
    r.report(20, 'stage_scan');           // same tick -> throttled
    expect(send).toHaveBeenCalledTimes(1);
    now = 2000;
    r.report(30, 'stage_scan');           // 1000ms later -> send
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith({ type: 'EXTRACTION_PROGRESS', percent: 30, stage: 'stage_scan' });
  });

  it('force bypasses the throttle and clamps/rounds percent', () => {
    const send = vi.fn();
    const r = createProgressReporter(send, () => 5000, 1000);
    r.report(0, 'stage_ads', true);
    r.report(150, 'stage_capture', true);  // clamp to 100
    r.report(41.6, 'stage_scan', true);    // round to 42
    expect(send).toHaveBeenCalledTimes(3);
    expect(send).toHaveBeenNthCalledWith(2, { type: 'EXTRACTION_PROGRESS', percent: 100, stage: 'stage_capture' });
    expect(send).toHaveBeenNthCalledWith(3, { type: 'EXTRACTION_PROGRESS', percent: 42, stage: 'stage_scan' });
  });
});
