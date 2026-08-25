import { sanitizeFilename } from '../core/format';
import type { SessionData } from '../core/types';
import type { CaptionPresentation } from './caption-presentation';
import { buildHtmlBook, buildPdf, buildPptx, buildTxt, downloadBlob } from './exporters';
import { buildBookData, type SelectedScene } from './book-data';
import type { BookLabels } from './html-book';
import { resizeForBook, resizeForSlides } from './image-resize';
import { applyI18n, t } from '../ui/i18n';

const DOWNLOAD_BUTTONS_HTML = `
      <button id="dl-pdf" class="dl"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3v5h5"/><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/></svg><span>PDF <span class="fmt" data-i18n="dl_pdf_sub">장면 모음</span></span></button>
      <button id="dl-pptx" class="dl"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8"/></svg><span>PPTX <span class="fmt" data-i18n="dl_pptx_sub">장면+대본</span></span></button>
      <button id="dl-txt" class="dl"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h10"/></svg><span>TXT <span class="fmt" data-i18n="dl_txt_sub">대본</span></span></button>
      <button id="dl-html" class="dl"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5a2 2 0 0 1 2-2h6v18H5a2 2 0 0 1-2-2z"/><path d="M21 5a2 2 0 0 0-2-2h-6v18h6a2 2 0 0 0 2-2z"/></svg><span><span data-i18n="dl_html">웹페이지</span> <span class="fmt" data-i18n="dl_html_sub">책처럼 읽기</span></span></button>`;

const DOWNLOAD_FOOT_HTML = `
    <div class="dl-foot">
      <label class="switch" data-i18n-title="downscale_title" title="PDF·PPTX·웹페이지 사진을 1280px로 줄여 파일 용량을 낮춥니다. 크게 보거나 인쇄·발표할 땐 끄세요.">
        <input type="checkbox" id="downscale-images">
        <span class="track"><span class="knob"></span></span>
        <span data-i18n="downscale_label">사진 용량 줄이기 (해상도↓)</span>
      </label>
      <span id="export-status" class="status"></span>
    </div>`;

export interface DownloadPanelDeps {
  panel: HTMLElement;
  getSelectedScenes: () => SelectedScene[];
  meta: SessionData['meta'];
  captionPresentation: CaptionPresentation;
}

/** Full-edition only. Injects the download buttons + downscale toggle into the
 *  export panel and wires them. Dynamically imported so the Lite build excludes
 *  this module and its exporter/jspdf/pptxgenjs dependency chain. */
export function mountDownloadPanel(deps: DownloadPanelDeps): void {
  const { panel, getSelectedScenes, meta, captionPresentation } = deps;

  const grid = panel.querySelector('.dl-grid')!;
  grid.insertAdjacentHTML('afterbegin', DOWNLOAD_BUTTONS_HTML);
  grid.insertAdjacentHTML('afterend', DOWNLOAD_FOOT_HTML);
  applyI18n(panel);

  const $ = <T extends HTMLElement>(sel: string) => panel.querySelector<T>(sel)!;

  const busy = async (btn: HTMLButtonElement, fn: () => Promise<void>) => {
    btn.disabled = true;
    $('#export-status').textContent = t('export_generating');
    try {
      await fn();
      $('#export-status').textContent = t('export_done');
    } catch (err) {
      $('#export-status').textContent = t('export_failed', err instanceof Error ? err.message : String(err));
    } finally {
      btn.disabled = false;
    }
  };
  const base = () => sanitizeFilename(meta.title);
  const { videoWidth: vw, videoHeight: vh } = meta;
  const wantsDownscale = () => ($('#downscale-images') as HTMLInputElement).checked;

  $('#dl-pdf').addEventListener('click', e =>
    void busy(e.currentTarget as HTMLButtonElement, async () => {
      const scenes = getSelectedScenes();
      const images = await Promise.all(scenes.map(s => resizeForSlides(s.image, wantsDownscale())));
      downloadBlob(buildPdf(images, vw, vh), `${base()}_scenes.pdf`);
    }));
  $('#dl-pptx').addEventListener('click', e =>
    void busy(e.currentTarget as HTMLButtonElement, async () => {
      const scenes = getSelectedScenes();
      const downscale = wantsDownscale();
      const slides = await Promise.all(scenes.map(async s => ({
        image: await resizeForSlides(s.image, downscale),
        notes: s.script,
      })));
      downloadBlob(await buildPptx(slides, vw, vh), `${base()}_scenes.pptx`);
    }));
  const txtBtn = $('#dl-txt') as HTMLButtonElement;
  txtBtn.disabled = !captionPresentation.txtEnabled;
  txtBtn.addEventListener('click', e =>
    void busy(e.currentTarget as HTMLButtonElement, async () => {
      const entries = getSelectedScenes().map(s => ({
        startSec: s.scriptStartSec, endSec: s.scriptEndSec, text: s.script,
      }));
      downloadBlob(buildTxt(entries), `${base()}_script.txt`);
    }));
  const htmlLabels = (): BookLabels => ({
    playCaption: t('book_playCaption'),
    openOriginal: t('book_openOriginal'),
    zoomCaption: t('book_zoomCaption'),
    viewToggle: t('book_viewToggle'),
    prevScene: t('book_prevScene'),
    nextScene: t('book_nextScene'),
  });
  const uiLang = (): string => chrome.i18n?.getUILanguage?.() || 'en';
  $('#dl-html').addEventListener('click', e =>
    void busy(e.currentTarget as HTMLButtonElement, async () => {
      const book = await buildBookData(
        getSelectedScenes(),
        meta,
        img => resizeForBook(img, wantsDownscale()),
      );
      downloadBlob(buildHtmlBook(book, htmlLabels(), uiLang()), `${base()}_book.html`);
    }));
}
