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
  zoomCaption: string;
}

function deepLinkUrl(videoId: string, sec: number): string {
  const t = Number.isFinite(sec) ? Math.max(0, Math.floor(sec)) : 0;
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&t=${t}s`;
}

function sceneBlockHtml(
  block: SceneBlock,
  videoId: string,
  labels: BookLabels,
  index: number,
): string {
  const href = escapeHtml(deepLinkUrl(videoId, block.deepLinkSec));
  const zoom = escapeHtml(labels.zoomCaption);
  const id = `zoom-${index}`;
  return `    <article class="scene">
      <div class="photo">
        <input type="checkbox" id="${id}" class="zoom-toggle" aria-hidden="true">
        <a class="photo-link" href="${href}" target="_blank" rel="noopener">
          <img src="${block.image}" alt="${escapeHtml(labels.playCaption)}" loading="lazy">
          <span class="play" aria-hidden="true">▶</span>
        </a>
        <label class="zoom" for="${id}" title="${zoom}" aria-label="${zoom}">⛶</label>
        <label class="lightbox" for="${id}" aria-hidden="true"></label>
      </div>
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
  .zoom-toggle { position: absolute; width: 1px; height: 1px; margin: 0; opacity: 0; pointer-events: none; }
  .photo .zoom { position: absolute; right: 10px; bottom: 10px; z-index: 2; cursor: zoom-in;
    color: #fff; background: rgba(0,0,0,.6); font-size: .85rem; line-height: 1;
    padding: 4px 8px; border-radius: 99px; user-select: none; }
  .lightbox { display: none; }
  .zoom-toggle:checked ~ .lightbox { display: block; position: fixed; inset: 0; z-index: 100;
    background: rgba(0,0,0,.88); cursor: zoom-out; }
  .zoom-toggle:checked ~ .photo-link img { position: fixed; inset: 0; margin: auto; z-index: 101;
    width: auto; height: auto; max-width: 96vw; max-height: 96vh; border-radius: 8px;
    box-shadow: 0 10px 50px rgba(0,0,0,.55); pointer-events: none; }
  .zoom-toggle:checked ~ .photo-link .play { display: none; }
  body:has(.zoom-toggle:checked) { overflow: hidden; }
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
  const scenes = book.scenes.map((s, i) => sceneBlockHtml(s, book.videoId, labels, i)).join('\n');
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
