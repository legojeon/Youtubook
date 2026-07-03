import type { Cue } from './types';

/** [startSec, endSec) 구간과 겹치는 큐. 경계에 걸친 큐는 양쪽 장면에 모두 포함된다(의도된 동작). */
export function cuesForRange(cues: Cue[], startSec: number, endSec: number): Cue[] {
  return cues.filter(c => c.startSec < endSec && c.endSec > startSec);
}

export function scriptForRange(cues: Cue[], startSec: number, endSec: number): string {
  return cuesForRange(cues, startSec, endSec).map(c => c.text).join(' ');
}
