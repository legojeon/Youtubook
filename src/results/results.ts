import { DEFAULT_DETECT, detectScenes } from '../core/detect';
import { formatTimestamp } from '../core/format';
import { scriptFromSentences } from '../core/mapping';
import { cuesToSentences } from '../core/sentences';
import { repKey, type Cue, type SessionData } from '../core/types';
import type { Msg, MsgResponse, RepRef } from '../messages';
import { getSession, updateSession } from '../storage/db';
import { acceptedFrameMessage } from './accepted-frame';
import { captionPresentationForMeta } from './caption-presentation';
import { imageFor, selectedScenes, type SelectedScene } from './book-data';
import { applyI18n, t } from '../ui/i18n';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const grid = $('#grid');
const banners = $('#banners');

let session: SessionData;
const selected = new Set<string>(); // repKey 기준 — 재검출 후에도 유지
let sentences: Cue[] = []; // session.cues에서 1회 재조립 — 민감도 변경(재검출)에도 cues는 불변이라 재계산 불필요

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
      img.src = imageFor(session, range);
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
      script.textContent = scriptFromSentences(sentences, range.startSec, range.endSec);

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

function getSelectedScenes(): SelectedScene[] {
  return selectedScenes(session, sentences, selected);
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
  sentences = cuesToSentences(session.cues, session.meta.captionLang);
  const captionPresentation = captionPresentationForMeta(session.meta);

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

  // View as book — edition-neutral (no download).
  $('#view-book').addEventListener('click', () => {
    void chrome.storage.session
      .set({ [`book:${session.meta.id}`]: [...selected] })
      .then(() =>
        chrome.tabs.create({
          url: `${chrome.runtime.getURL('src/viewer/viewer.html')}?session=${encodeURIComponent(session.meta.id)}`,
        }),
      );
  });

  render();

  // Export/download UI is Full-edition only. In the Lite (Web Store) build the
  // else-branch is statically dead, so download-panel + exporters + jspdf +
  // pptxgenjs are tree-shaken out of the bundle entirely.
  if (__WEBSTORE__) {
    $('#export-panel').classList.add('webstore');
    $('#export-heading').textContent = t('webstore_panel_heading');
    ($('#install-full') as HTMLElement).hidden = false;
    ($('#install-full-note') as HTMLElement).hidden = false;
  } else {
    $('#export-heading').textContent = t('dl_heading');
    const { mountDownloadPanel } = await import('./download-panel');
    mountDownloadPanel({
      panel: $('#export-panel'),
      getSelectedScenes,
      meta: session.meta,
      captionPresentation,
    });
  }

  if (captionPresentation.warningKey) banner(t(captionPresentation.warningKey));
  if (session.meta.truncated) {
    banner(t('banner_truncated'));
  }
})();
