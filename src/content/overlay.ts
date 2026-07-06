import { t } from '../ui/i18n';

export interface Overlay {
  setStage(text: string): void;
  setProgress(done: number, total: number): void;
  showError(text: string): void;
  remove(): void;
}

export function createOverlay(onCancel: () => void): Overlay {
  const host = document.createElement('div');
  host.id = 'youtubook-overlay';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      .box {
        position: fixed; top: 12px; left: 50%; transform: translateX(-50%);
        z-index: 2147483647; background: rgba(20, 20, 20, .95); color: #fff;
        font-size: 13px; line-height: 1.5; border-radius: 16px;
        padding: 12px 16px; width: 340px; box-shadow: 0 4px 16px rgba(0,0,0,.4);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Apple SD Gothic Neo", sans-serif;
      }
      .row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
      .stage { font-weight: 600; }
      .hint { color: #bbb; font-size: 11px; margin-top: 4px; }
      .bar { height: 6px; background: #444; border-radius: 3px; margin-top: 8px; overflow: hidden; }
      /* accent mirrors theme.css --primary (#e60023) / --r-md (16px); shadow DOM can't link theme.css */
      .fill { height: 100%; width: 0%; background: #e60023; transition: width .2s; }
      .error { color: #ff6b6b; font-weight: 600; }
      button {
        background: none; border: 1px solid #666; color: #ddd;
        border-radius: 6px; padding: 2px 10px; cursor: pointer; font-size: 12px;
      }
      button:hover { border-color: #aaa; color: #fff; }
    </style>
    <div class="box">
      <div class="row">
        <span class="stage">${t('overlay_preparing')}</span>
        <button type="button">${t('overlay_cancel')}</button>
      </div>
      <div class="bar"><div class="fill"></div></div>
      <div class="hint">${t('overlay_keepTab')}</div>
    </div>
  `;
  root.querySelector('button')!.addEventListener('click', onCancel);
  document.documentElement.appendChild(host);

  const stage = root.querySelector<HTMLElement>('.stage')!;
  const fill = root.querySelector<HTMLElement>('.fill')!;
  return {
    setStage(text) { stage.textContent = text; stage.classList.remove('error'); },
    setProgress(done, total) { fill.style.width = `${total ? Math.round((done / total) * 100) : 0}%`; },
    showError(text) {
      stage.textContent = text;
      stage.classList.add('error');
      setTimeout(() => host.remove(), 4000);
    },
    remove() { host.remove(); },
  };
}
