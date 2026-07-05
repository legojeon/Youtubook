import { describe, expect, it } from 'vitest';
import { buildHtmlBook, escapeHtml, type BookData } from './html-book';

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

const html = (data: BookData): Promise<string> => buildHtmlBook(data).text();

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
});
