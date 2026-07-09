// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAdShowing, clickSkipIfPresent, shouldAbortForSkips } from './extractor';

afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function makePlayer(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'movie_player';
  document.body.appendChild(el);
  return el;
}

describe('isAdShowing', () => {
  it('true when player has ad-showing or ad-interrupting', () => {
    const p = makePlayer();
    expect(isAdShowing(p)).toBe(false);
    p.classList.add('ad-showing');
    expect(isAdShowing(p)).toBe(true);
    p.classList.remove('ad-showing');
    p.classList.add('ad-interrupting');
    expect(isAdShowing(p)).toBe(true);
  });
  it('false for null', () => { expect(isAdShowing(null)).toBe(false); });
});

describe('clickSkipIfPresent', () => {
  it('clicks the first visible skip button', () => {
    const p = makePlayer();
    const btn = document.createElement('button');
    btn.className = 'ytp-ad-skip-button-modern';
    // jsdom does no layout, so offsetParent is always null — stub it to simulate visibility.
    Object.defineProperty(btn, 'offsetParent', { configurable: true, get: () => document.body });
    const click = vi.spyOn(btn, 'click');
    p.appendChild(btn);
    clickSkipIfPresent(p);
    expect(click).toHaveBeenCalledTimes(1);
  });
  it('does nothing when the button is hidden (offsetParent null) or absent', () => {
    const p = makePlayer();
    const btn = document.createElement('button');
    btn.className = 'ytp-ad-skip-button-modern'; // offsetParent stays null (hidden)
    const click = vi.spyOn(btn, 'click');
    p.appendChild(btn);
    clickSkipIfPresent(p);
    clickSkipIfPresent(null);
    expect(click).not.toHaveBeenCalled();
  });
});

describe('shouldAbortForSkips', () => {
  it('aborts on a long consecutive skip streak', () => {
    expect(shouldAbortForSkips(8, 8, 8)).toBe(true);
    expect(shouldAbortForSkips(7, 7, 7)).toBe(false);
  });
  it('aborts when >30% of a meaningful sample is skipped', () => {
    expect(shouldAbortForSkips(1, 4, 10)).toBe(true);   // 4/10 = 40% > 30%, done>=10
    expect(shouldAbortForSkips(1, 2, 10)).toBe(false);  // 2/10 = 20%
    expect(shouldAbortForSkips(1, 3, 5)).toBe(false);   // done<10 → ratio not judged yet
  });
});
