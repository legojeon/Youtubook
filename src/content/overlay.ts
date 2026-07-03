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
        font: 13px/1.5 system-ui, sans-serif; border-radius: 10px;
        padding: 12px 16px; width: 340px; box-shadow: 0 4px 16px rgba(0,0,0,.4);
      }
      .row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
      .stage { font-weight: 600; }
      .hint { color: #bbb; font-size: 11px; margin-top: 4px; }
      .bar { height: 6px; background: #444; border-radius: 3px; margin-top: 8px; overflow: hidden; }
      .fill { height: 100%; width: 0%; background: #3ea6ff; transition: width .2s; }
      .error { color: #ff6b6b; font-weight: 600; }
      button {
        background: none; border: 1px solid #666; color: #ddd;
        border-radius: 6px; padding: 2px 10px; cursor: pointer; font-size: 12px;
      }
      button:hover { border-color: #aaa; color: #fff; }
    </style>
    <div class="box">
      <div class="row">
        <span class="stage">준비 중…</span>
        <button type="button">취소</button>
      </div>
      <div class="bar"><div class="fill"></div></div>
      <div class="hint">추출 중에는 이 탭을 화면에 유지해주세요.</div>
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
