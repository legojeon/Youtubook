import { describe, expect, it } from 'vitest';
import { buildHtmlBook, escapeHtml, renderBookBodyHtml, type BookData, type BookLabels } from './html-book';

const IMG = 'data:image/jpeg;base64,/9j/AAAA/9k=';

function book(overrides: Partial<BookData> = {}): BookData {
  return {
    title: '여우 이야기',
    videoUrl: 'https://www.youtube.com/watch?v=abc123',
    videoId: 'abc123',
    cover: { title: '여우 이야기', image: IMG },
    scenes: [
      { image: IMG, script: '여우는 언덕에 올랐다.', deepLinkSec: 12.7 },
      { image: IMG, script: '별이 빛났다.', deepLinkSec: 40.2 },
    ],
    ...overrides,
  };
}

const LABELS: BookLabels = { playCaption: '장면 — 이 순간부터 영상 보기', openOriginal: '원본 영상 열기 ↗', zoomCaption: '사진 확대', viewToggle: '슬라이드/블로그 보기 전환', prevScene: '이전 장면', nextScene: '다음 장면' };

const html = (data: BookData): Promise<string> => buildHtmlBook(data, LABELS, 'ko').text();

describe('escapeHtml', () => {
  it('HTML 특수문자를 이스케이프한다', () => {
    expect(escapeHtml(`<b>"a"&'b'`)).toBe('&lt;b&gt;&quot;a&quot;&amp;&#39;b&#39;');
  });
});

describe('buildHtmlBook', () => {
  it('표지 제목과 표지 이미지를 포함한다', async () => {
    const out = await html(book());
    expect(out).toContain('<h1>여우 이야기</h1>');
    expect(out).toContain(`src="${IMG}"`);
  });

  it('장면 수만큼 블록을 만든다', async () => {
    const out = await html(book());
    expect(out.match(/<article class="scene">/g)).toHaveLength(2);
  });

  it('videoId와 floor 초로 딥링크를 만든다(속성 이스케이프 포함)', async () => {
    const out = await html(book());
    expect(out).toContain('href="https://www.youtube.com/watch?v=abc123&amp;t=12s"');
    expect(out).toContain('&amp;t=40s"');
  });

  it('각 블록에 base64 이미지를 임베드한다(표지+2장면 = 3회 이상)', async () => {
    const out = await html(book());
    expect(out.split(IMG).length - 1).toBeGreaterThanOrEqual(3);
  });

  it('반응형 좌우 배치 브레이크포인트를 포함한다', async () => {
    const out = await html(book());
    expect(out).toContain('@media (min-width: 700px)');
  });

  it('장면마다 고유 id의 확대 토글과 확대 버튼을 만든다', async () => {
    const out = await html(book());
    expect(out.match(/class="zoom-toggle"/g)).toHaveLength(2);
    expect(out).toContain('id="zoom-0"');
    expect(out).toContain('id="zoom-1"');
    expect(out).toContain('for="zoom-0"');
    expect(out).toContain('class="lightbox"');
    expect(out).toContain('aria-label="사진 확대"');
  });

  it('슬라이드/블로그 전환 버튼을 우측 하단에 렌더링한다', async () => {
    const out = await html(book());
    expect(out).toContain('class="view-toggle"');
    expect(out).toContain('aria-label="슬라이드/블로그 보기 전환"');
  });

  it('전환 버튼은 이모지 대신 svg 아이콘을 사용한다', async () => {
    const out = await html(book());
    expect(out).toMatch(/<button class="view-toggle"[^>]*>\s*<svg/);
    expect(out).not.toContain('🖥️');
  });

  it('슬라이드 모드용 CSS와 이전/다음 내비게이션 컨트롤을 포함한다', async () => {
    const out = await html(book());
    expect(out).toContain('slide-mode');
    expect(out).toContain('class="slide-nav"');
    expect(out).toContain('aria-label="이전 장면"');
    expect(out).toContain('aria-label="다음 장면"');
  });

  it('전환 동작을 위한 인라인 스크립트를 포함한다', async () => {
    const out = await html(book());
    expect(out).toContain('<script>');
    expect(out).toContain('slide-mode');
  });

  it('스페이스바로 다음 장면으로 넘어가는 처리를 포함한다', async () => {
    const out = await html(book());
    expect(out).toMatch(/e\.key\s*===\s*(['"]) \1/);
  });

  it('장면이 없으면 전환 버튼을 렌더링하지 않는다', async () => {
    const out = await html(book({ scenes: [] }));
    expect(out).not.toContain('class="view-toggle"');
  });

  it('전환 UI 라벨도 이스케이프해 주입을 막는다', async () => {
    const out = await buildHtmlBook(
      book(),
      { ...LABELS, viewToggle: '<v>', prevScene: '<p>', nextScene: '<n>' },
      'ko',
    ).text();
    expect(out).toContain('&lt;v&gt;');
    expect(out).not.toContain('aria-label="<v>"');
  });

  it('제목과 자막을 이스케이프해 주입을 막는다', async () => {
    const out = await html(book({
      title: '<script>alert(1)</script>',
      cover: { title: '<script>alert(1)</script>', image: IMG },
      scenes: [{ image: IMG, script: '<script>bad()</script>', deepLinkSec: 1 }],
    }));
    expect(out).not.toContain('<script>alert(1)</script>');
    expect(out).not.toContain('<script>bad()</script>');
    expect(out).toContain('&lt;script&gt;bad()&lt;/script&gt;');
  });

  it('자막이 비어도 블록을 만든다', async () => {
    const out = await html(book({ scenes: [{ image: IMG, script: '', deepLinkSec: 5 }] }));
    expect(out.match(/<article class="scene">/g)).toHaveLength(1);
  });

  it('장면이 없으면 표지만 있고 장면 블록은 0개다', async () => {
    const out = await html(book({ scenes: [] }));
    expect(out).toContain('<h1>여우 이야기</h1>');
    expect(out.match(/<article class="scene">/g)).toBeNull();
  });

  it('표지 이미지가 비어있으면 표지 img를 렌더링하지 않는다', async () => {
    const out = await html(book({ cover: { title: '표지', image: '' } }));
    expect(out.match(/<img/g)).toHaveLength(2);
  });

  it('음수 deepLinkSec은 0초로 고정된다', async () => {
    const out = await html(book({ scenes: [{ image: IMG, script: '음수', deepLinkSec: -5 }] }));
    expect(out).toContain('&amp;t=0s');
  });

  it('비유한(NaN) deepLinkSec은 0초로 고정된다', async () => {
    const out = await html(book({ scenes: [{ image: IMG, script: 'NaN', deepLinkSec: NaN }] }));
    expect(out).toContain('t=0s');
  });
});

describe('renderBookBodyHtml', () => {
  it('본문만 반환하고 doctype/style은 포함하지 않는다', () => {
    const out = renderBookBodyHtml(book(), LABELS);
    expect(out).toContain('<div class="wrap">');
    expect(out).not.toContain('<!doctype html>');
    expect(out).not.toContain('<style>');
  });

  it('라벨(원본 링크·이미지 alt)을 주입한다', () => {
    const out = renderBookBodyHtml(book(), LABELS);
    expect(out).toContain('원본 영상 열기 ↗');
    expect(out).toContain('alt="장면 — 이 순간부터 영상 보기"');
  });

  it('라벨도 이스케이프한다', () => {
    const out = renderBookBodyHtml(book(), { ...LABELS, playCaption: '<x>', openOriginal: '<y>', zoomCaption: '<z>' });
    expect(out).toContain('&lt;x&gt;');
    expect(out).toContain('&lt;y&gt;');
    expect(out).toContain('&lt;z&gt;');
    expect(out).not.toContain('<x>');
    expect(out).not.toContain('<z>');
  });
});
