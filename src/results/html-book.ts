export interface SceneBlock {
  image: string; // base64 data URL (JPEG)
  script: string;
  deepLinkSec: number;
}

export interface BookData {
  title: string;
  videoUrl: string;
  videoId: string;
  cover: { title: string; image: string };
  scenes: SceneBlock[];
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface BookLabels {
  playCaption: string;
  openOriginal: string;
}

function deepLinkUrl(videoId: string, sec: number): string {
  const t = Number.isFinite(sec) ? Math.max(0, Math.floor(sec)) : 0;
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&t=${t}s`;
}

function sceneBlockHtml(block: SceneBlock, videoId: string, labels: BookLabels): string {
  const href = escapeHtml(deepLinkUrl(videoId, block.deepLinkSec));
  return `    <article class="scene">
      <a class="photo" href="${href}" target="_blank" rel="noopener">
        <img src="${block.image}" alt="${escapeHtml(labels.playCaption)}" loading="lazy">
        <span class="play">▶</span>
      </a>
      <p class="script">${escapeHtml(block.script)}</p>
    </article>`;
}

export const BOOK_STYLE = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; line-height: 1.7; background: #faf9f7; color: #23262e;
    font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Segoe UI", Roboto, sans-serif; }
  .wrap { max-width: 720px; margin: 0 auto; padding: 16px; }
  .cover { text-align: center; padding: 24px 0 8px; }
  .cover img { width: 100%; border-radius: 12px; display: block; }
  .cover h1 { font-size: 1.4rem; margin: 16px 0 4px; }
  .cover a { font-size: .85rem; color: #3d7bd0; text-decoration: none; }
  .scene { margin: 22px 0; }
  .photo { position: relative; display: block; }
  .photo img { width: 100%; border-radius: 10px; display: block; }
  .photo .play { position: absolute; left: 10px; bottom: 10px; color: #fff;
    background: rgba(0,0,0,.6); font-size: .8rem; padding: 2px 9px; border-radius: 99px; }
  .script { margin: 10px 2px 0; font-size: 1.02rem; white-space: pre-wrap; }
  @media (min-width: 700px) {
    .wrap { max-width: 960px; }
    .scene { display: flex; gap: 18px; align-items: flex-start; }
    .photo { flex: 0 0 55%; }
    .script { flex: 1; margin-top: 0; }
  }
  @media (prefers-color-scheme: dark) {
    body { background: #16171b; color: #e9e9ec; }
    .cover a { color: #7fb0f0; }
  }`;

export function renderBookBodyHtml(book: BookData, labels: BookLabels): string {
  const scenes = book.scenes.map(s => sceneBlockHtml(s, book.videoId, labels)).join('\n');
  const coverImg = book.cover.image
    ? `<img src="${book.cover.image}" alt="${escapeHtml(book.cover.title)}">`
    : '';
  return `<div class="wrap">
  <header class="cover">
    ${coverImg}
    <h1>${escapeHtml(book.cover.title)}</h1>
    <a href="${escapeHtml(book.videoUrl)}" target="_blank" rel="noopener">${escapeHtml(labels.openOriginal)}</a>
  </header>
  <main>
${scenes}
  </main>
</div>`;
}

export function buildHtmlBook(book: BookData, labels: BookLabels, lang: string): Blob {
  const html = `<!doctype html>
<html lang="${escapeHtml(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(book.title)}</title>
<style>${BOOK_STYLE}
</style>
</head>
<body>
${renderBookBodyHtml(book, labels)}
</body>
</html>`;
  return new Blob([html], { type: 'text/html;charset=utf-8' });
}
