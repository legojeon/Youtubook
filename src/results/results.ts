import { DEFAULT_DETECT, detectScenes } from '../core/detect';
import { formatTimestamp, sanitizeFilename } from '../core/format';
import { scriptForRange, scriptSpans } from '../core/mapping';
import { repKey, type SceneRange, type SessionData } from '../core/types';
import type { Msg, MsgResponse, RepRef } from '../messages';
import { getSession, updateSession } from '../storage/db';
import { acceptedFrameMessage } from './accepted-frame';
import { captionPresentationForMeta } from './caption-presentation';
import { buildHtmlBook, buildPdf, buildPptx, buildTxt, downloadBlob, type BookData } from './exporters';
import { resizeForBook, resizeForSlides } from './image-resize';
import { applyI18n, t } from '../ui/i18n';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const grid = $('#grid');
const banners = $('#banners');

let session: SessionData;
const selected = new Set<string>(); // repKey 기준 — 재검출 후에도 유지

function thumbFor(repSec: number): string {
  const i = Math.min(session.thumbs.length - 1, Math.floor(repSec / session.meta.sampleIntervalSec));
  return session.thumbs[i] ?? '';
}

function imageFor(range: SceneRange): string {
  return session.images[repKey(range.repSec)] ?? thumbFor(range.repSec);
}

function banner(text: string, kind: 'warn' | 'error' = 'warn'): void {
  const div = document.createElement('div');
  div.className = `banner${kind === 'error' ? ' error' : ''}`;
  div.textContent = text;
  banners.appendChild(div);
  if (kind === 'error') setTimeout(() => div.remove(), 6000);
}

function updateSelectedCount(): void {
  $('#selected-count').textContent = t('selectedCount', String(selected.size));
  ($('#next') as HTMLButtonElement).disabled = selected.size === 0;
}

function render(): void {
  $('#video-title').textContent = session.meta.title;
  $('#scene-count').textContent = t('sceneCount', String(session.ranges.length));
  grid.replaceChildren(
    ...session.ranges.map(range => {
      const key = repKey(range.repSec);
      const card = document.createElement('div');
      card.className = `card${selected.has(key) ? ' selected' : ''}`;
      card.dataset.key = key;

      const img = document.createElement('img');
      img.src = imageFor(range);
      img.loading = 'lazy';

      const meta = document.createElement('div');
      meta.className = 'meta';
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = selected.has(key);
      const label = document.createElement('span');
      label.textContent = `${formatTimestamp(range.startSec)} – ${formatTimestamp(range.endSec)}`;
      meta.append(check, label);

      const script = document.createElement('div');
      script.className = 'script';
      script.textContent = scriptForRange(session.cues, range.startSec, range.endSec);

      card.append(img, meta, script);
      card.addEventListener('click', () => {
        if (selected.has(key)) selected.delete(key); else selected.add(key);
        check.checked = selected.has(key);
        card.classList.toggle('selected', selected.has(key));
        updateSelectedCount();
      });
      return card;
    }),
  );
  updateSelectedCount();
}

async function redetect(): Promise<void> {
  const btn = $('#redetect') as HTMLButtonElement;
  btn.disabled = true;
  try {
    const sensitivity = Number(($('#sensitivity') as HTMLInputElement).value);
    const det = detectScenes(session.scores, {
      ...DEFAULT_DETECT,
      sensitivity,
      sampleIntervalSec: session.meta.sampleIntervalSec,
      durationSec: session.meta.durationSec,
    });
    const updated = await updateSession(session.meta.id, s => ({
      ...s,
      ranges: det.ranges,
      meta: { ...s.meta, sensitivity, truncated: det.truncated },
    }));
    if (!updated) {
      banner(t('banner_saveFail'), 'error');
      return;
    }
    session = { ...updated, images: { ...session.images, ...updated.images } };
    render();

    const missing: RepRef[] = session.ranges
      .filter(r => !session.images[repKey(r.repSec)])
      .map(r => ({ key: repKey(r.repSec), repSec: r.repSec }));
    if (!missing.length) return;

    const res = await chrome.runtime.sendMessage<Msg, MsgResponse>({
      type: 'REQUEST_CAPTURES', sessionId: session.meta.id, reps: missing,
    });
    if (!res.ok) {
      banner(
        res.reason === 'tab-closed' || res.reason === 'wrong-video'
          ? t('banner_recaptureTab')
          : t('banner_recaptureFail', res.reason ?? 'unknown'),
        'error',
      );
    }
  } finally {
    btn.disabled = false;
  }
}

// SW가 검증하고 저장한 재캡처 프레임만 실시간 반영
chrome.runtime.onMessage.addListener((msg: unknown) => {
  const message = acceptedFrameMessage(msg);
  if (!message || message.sessionId !== session?.meta.id) return;
  if (!session.ranges.some(range => repKey(range.repSec) === message.key)) return;
  session.images[message.key] = message.dataUrl;
  const img = grid.querySelector<HTMLImageElement>(`.card[data-key="${message.key}"] img`);
  if (img) img.src = message.dataUrl;
});

export interface SelectedScene {
  range: SceneRange;
  image: string;
  script: string;
  scriptStartSec: number; // 이 장면이 담당하는 대본 구간 (선택 장면 기준 타임라인 분할)
  scriptEndSec: number;
}

function getSelectedScenes(): SelectedScene[] {
  const picked = session.ranges
    .filter(r => selected.has(repKey(r.repSec)))
    .sort((a, b) => a.startSec - b.startSec);
  // 선택 장면들로 전체 타임라인을 분할 — 각 장면이 다음 선택 장면 전까지의
  // 자막을 모두 가져가 내레이션이 빠지지 않는다 (그림책 읽어주기 용도).
  const spans = scriptSpans(picked.map(r => r.startSec), session.meta.durationSec);
  return picked.map((range, i) => ({
    range,
    image: imageFor(range),
    script: scriptForRange(session.cues, spans[i].startSec, spans[i].endSec),
    scriptStartSec: spans[i].startSec,
    scriptEndSec: spans[i].endSec,
  }));
}
void (async () => {
  applyI18n(document);
  const id = new URLSearchParams(location.search).get('session');
  const loaded = id ? await getSession(id) : null;
  if (!loaded) {
    $('#video-title').textContent = t('results_notFound');
    return;
  }
  session = loaded;

  ($('#sensitivity') as HTMLInputElement).value = String(session.meta.sensitivity);
  $('#sensitivity-value').textContent = String(session.meta.sensitivity);
  $('#sensitivity').addEventListener('input', e => {
    $('#sensitivity-value').textContent = (e.target as HTMLInputElement).value;
  });
  $('#redetect').addEventListener('click', () => void redetect());
  $('#select-all').addEventListener('click', () => {
    session.ranges.forEach(r => selected.add(repKey(r.repSec)));
    render();
  });
  $('#select-none').addEventListener('click', () => {
    selected.clear();
    render();
  });
  $('#next').addEventListener('click', () => {
    $('#export-panel').hidden = false;
    $('#export-panel').scrollIntoView({ behavior: 'smooth' });
  });

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
  const base = () => sanitizeFilename(session.meta.title);
  const { videoWidth: vw, videoHeight: vh } = session.meta;
  // Global export option: downscale embedded frames to shrink every download.
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
  const captionPresentation = captionPresentationForMeta(session.meta);
  txtBtn.disabled = !captionPresentation.txtEnabled;
  txtBtn.addEventListener('click', e =>
    void busy(e.currentTarget as HTMLButtonElement, async () => {
      const entries = getSelectedScenes().map(s => ({
        startSec: s.scriptStartSec, endSec: s.scriptEndSec, text: s.script,
      }));
      downloadBlob(buildTxt(entries), `${base()}_script.txt`);
    }));
  $('#dl-html').addEventListener('click', e =>
    void busy(e.currentTarget as HTMLButtonElement, async () => {
      const scenes = getSelectedScenes();
      // Full-resolution WebP by default; the shared toggle downscales for a smaller file.
      const images = await Promise.all(scenes.map(s => resizeForBook(s.image, wantsDownscale())));
      const bookData: BookData = {
        title: session.meta.title,
        videoUrl: session.meta.videoUrl,
        videoId: session.meta.videoId,
        cover: { title: session.meta.title, image: images[0] ?? '' },
        scenes: scenes.map((s, i) => ({
          image: images[i],
          script: s.script,
          deepLinkSec: s.range.repSec,
        })),
      };
      downloadBlob(buildHtmlBook(bookData), `${base()}_book.html`);
    }));

  if (captionPresentation.warning) banner(captionPresentation.warning);
  if (session.meta.truncated) {
    banner(t('banner_truncated'));
  }
  render();
})();
