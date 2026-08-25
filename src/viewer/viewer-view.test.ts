// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { BookData, BookLabels } from '../results/html-book';
import { renderViewer } from './viewer-view';

const IMG = 'data:image/jpeg;base64,AAAA';
const LABELS: BookLabels = { playCaption: '장면', openOriginal: '원본 ↗', zoomCaption: '확대', viewToggle: '전환', prevScene: '이전', nextScene: '다음' };

function book(): BookData {
  return {
    title: '여우 이야기',
    videoUrl: 'https://youtu.be/abc',
    videoId: 'abc',
    cover: { title: '여우 이야기', image: IMG },
    scenes: [
      { image: IMG, script: '언덕에 올랐다.', deepLinkSec: 3 },
      { image: IMG, script: '별이 빛났다.', deepLinkSec: 9 },
    ],
  };
}

describe('renderViewer', () => {
  it('책 본문을 컨테이너에 주입하고 문서 제목을 세팅한다', () => {
    const root = document.createElement('div');
    renderViewer(root, book(), LABELS);
    expect(root.querySelectorAll('article.scene')).toHaveLength(2);
    expect(root.innerHTML).toContain('언덕에 올랐다.');
    expect(document.title).toBe('여우 이야기');
  });
});
