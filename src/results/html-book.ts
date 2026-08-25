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
  viewToggle: string;
  prevScene: string;
  nextScene: string;
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
  .view-toggle { position: fixed; right: 14px; bottom: 14px; z-index: 70;
    display: flex; align-items: center; justify-content: center;
    width: 40px; height: 40px; padding: 0; border: none; background: none; cursor: pointer;
    color: #23262e; -webkit-tap-highlight-color: transparent;
    filter: drop-shadow(0 1px 2px rgba(0,0,0,.35)); }
  .slide-nav { display: none; }
  body.slide-mode { overflow: hidden; }
  body.slide-mode .view-toggle { bottom: 9px; right: 14px; }
  body.slide-mode .cover { display: none; }
  body.slide-mode .wrap { max-width: none; padding: 0; }
  body.slide-mode .scene { display: none; margin: 0; }
  body.slide-mode .scene.active { display: flex; flex-direction: column; align-items: center;
    position: fixed; inset: 0; z-index: 50; padding: 16px 16px 72px; background: #faf9f7; }
  body.slide-mode .photo { flex: 0 0 auto; width: 100%; max-width: 960px; text-align: center; }
  body.slide-mode .photo img { width: 100%; height: auto; max-height: 76vh; object-fit: contain; }
  body.slide-mode .photo .zoom { background: none; padding: 0; right: 12px; bottom: 12px;
    font-size: 1.4rem; text-shadow: 0 1px 4px rgba(0,0,0,.65); }
  body.slide-mode .script { flex: 1 1 auto; overflow-y: auto; width: 100%; max-width: 760px;
    margin: 14px 0 0; font-size: 1.1rem; text-align: center; }
  body.slide-mode .slide-nav { display: flex; position: fixed; left: 0; right: 0; bottom: 0;
    z-index: 60; align-items: center; justify-content: center; gap: 22px;
    padding: 10px 64px; background: rgba(250,249,247,.94); }
  .slide-nav button { border: none; background: none; cursor: pointer; color: #23262e;
    font-size: 1.7rem; line-height: 1; padding: 4px 14px; }
  .slide-nav button:disabled { opacity: .3; cursor: default; }
  .slide-nav .counter { font-size: .95rem; min-width: 64px; text-align: center; }
  @media (prefers-color-scheme: dark) {
    body { background: #16171b; color: #e9e9ec; }
    .cover a { color: #7fb0f0; }
    .view-toggle { color: #e9e9ec; }
    body.slide-mode .scene.active { background: #16171b; }
    body.slide-mode .view-toggle { color: #e9e9ec; }
    body.slide-mode .slide-nav { background: rgba(22,23,27,.94); }
    .slide-nav button { color: #e9e9ec; }
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

// Icon shown on the toggle = the mode you switch INTO.
// Slide: a screen (image) with a caption line below. Blog: stacked article lines.
export const ICON_SLIDE =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="1.5"/><line x1="7" y1="20" x2="17" y2="20"/></svg>';
export const ICON_BLOG =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="14" y2="18"/></svg>';

/**
 * Wires the blog/slide view toggle on the current document. Self-contained (closes
 * over no module scope) so it can be both called directly in the in-extension viewer
 * AND serialized via toString() into the exported HTML's inline script. The exported
 * file cannot import modules and the viewer (an MV3 page) forbids eval, so a shared
 * real function bridged by toString() is the single source of truth for both.
 */
export function initViewToggle(slideIcon: string, blogIcon: string): void {
  const body = document.body;
  const scenes = Array.prototype.slice.call(document.querySelectorAll('.scene')) as HTMLElement[];
  if (!scenes.length) return;
  const toggle = document.querySelector('.view-toggle') as HTMLElement;
  const nav = document.querySelector('.slide-nav') as HTMLElement;
  const counter = nav.querySelector('.counter') as HTMLElement;
  const prev = nav.querySelector('.prev') as HTMLButtonElement;
  const next = nav.querySelector('.next') as HTMLButtonElement;
  let i = 0;
  const show = (n: number): void => {
    i = Math.max(0, Math.min(scenes.length - 1, n));
    scenes.forEach((s, k) => s.classList.toggle('active', k === i));
    counter.textContent = i + 1 + ' / ' + scenes.length;
    prev.disabled = i === 0;
    next.disabled = i === scenes.length - 1;
  };
  const setMode = (on: boolean): void => {
    body.classList.toggle('slide-mode', on);
    toggle.innerHTML = on ? blogIcon : slideIcon;
    nav.setAttribute('aria-hidden', on ? 'false' : 'true');
    if (on) show(i);
  };
  toggle.addEventListener('click', () => setMode(!body.classList.contains('slide-mode')));
  prev.addEventListener('click', () => show(i - 1));
  next.addEventListener('click', () => show(i + 1));
  document.addEventListener('keydown', e => {
    if (!body.classList.contains('slide-mode')) return;
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      show(i + 1);
    } else if (e.key === 'ArrowLeft') show(i - 1);
    else if (e.key === 'Escape') setMode(false);
  });
  let x0: number | null = null;
  body.addEventListener(
    'touchstart',
    e => {
      if (body.classList.contains('slide-mode')) x0 = e.touches[0].clientX;
    },
    { passive: true },
  );
  body.addEventListener(
    'touchend',
    e => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0;
      x0 = null;
      if (Math.abs(dx) > 50) show(i + (dx < 0 ? 1 : -1));
    },
    { passive: true },
  );
}

const VIEW_TOGGLE_SCRIPT = `<script>(${initViewToggle.toString()})(${JSON.stringify(ICON_SLIDE)},${JSON.stringify(ICON_BLOG)});</script>`;

export function viewToggleHtml(book: BookData, labels: BookLabels): string {
  if (!book.scenes.length) return '';
  const vt = escapeHtml(labels.viewToggle);
  const prev = escapeHtml(labels.prevScene);
  const next = escapeHtml(labels.nextScene);
  return `<button class="view-toggle" type="button" aria-label="${vt}" title="${vt}">${ICON_SLIDE}</button>
<nav class="slide-nav" aria-hidden="true">
  <button class="prev" type="button" aria-label="${prev}">‹</button>
  <span class="counter">1 / ${book.scenes.length}</span>
  <button class="next" type="button" aria-label="${next}">›</button>
</nav>`;
}

export function buildHtmlBook(book: BookData, labels: BookLabels, lang: string): Blob {
  const controls = viewToggleHtml(book, labels);
  const script = book.scenes.length ? VIEW_TOGGLE_SCRIPT : '';
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
${controls}
${script}
</body>
</html>`;
  return new Blob([html], { type: 'text/html;charset=utf-8' });
}
