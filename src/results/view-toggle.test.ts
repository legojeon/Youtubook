// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ICON_BLOG,
  ICON_SLIDE,
  initViewToggle,
  renderBookBodyHtml,
  viewToggleHtml,
  type BookData,
  type BookLabels,
} from './html-book';

const IMG = 'data:image/jpeg;base64,AAAA';
const LABELS: BookLabels = {
  playCaption: '장면',
  openOriginal: '원본',
  zoomCaption: '확대',
  viewToggle: '전환',
  prevScene: '이전',
  nextScene: '다음',
};

function book(): BookData {
  return {
    title: '여우 이야기',
    videoUrl: 'https://youtu.be/abc',
    videoId: 'abc',
    cover: { title: '여우 이야기', image: IMG },
    scenes: [
      { image: IMG, script: '1', deepLinkSec: 1 },
      { image: IMG, script: '2', deepLinkSec: 2 },
      { image: IMG, script: '3', deepLinkSec: 3 },
    ],
  };
}

const toggle = (): HTMLElement => document.querySelector('.view-toggle') as HTMLElement;

describe('initViewToggle (in-viewer wiring)', () => {
  beforeEach(() => {
    document.body.className = '';
    document.body.innerHTML = renderBookBodyHtml(book(), LABELS) + viewToggleHtml(book(), LABELS);
    initViewToggle(ICON_SLIDE, ICON_BLOG);
  });

  it('토글 클릭 시 슬라이드 모드로 전환되고 첫 장면만 활성화된다', () => {
    toggle().click();
    expect(document.body.classList.contains('slide-mode')).toBe(true);
    expect(document.querySelectorAll('.scene.active')).toHaveLength(1);
    expect(document.querySelector('.scene.active')).toBe(document.querySelectorAll('.scene')[0]);
  });

  it('스페이스바로 다음 장면으로 이동한다', () => {
    toggle().click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    expect(document.querySelector('.slide-nav .counter')?.textContent).toBe('2 / 3');
  });

  it('토글을 다시 누르면 블로그 모드로 돌아온다', () => {
    toggle().click();
    toggle().click();
    expect(document.body.classList.contains('slide-mode')).toBe(false);
  });
});
