import type { ExtractionStatus, Msg, MsgResponse } from '../messages';
import { applyI18n, t } from '../ui/i18n';
import { popupView, type PopupMode, type PopupView } from './popup-view';

const btn = document.getElementById('go') as HTMLButtonElement;
const status = document.getElementById('status') as HTMLParagraphElement;

applyI18n(document);

/** Set the single button's label, style, and action-mode. Cancel is subdued (plain). */
function setMode(mode: PopupMode, disabled: boolean): void {
  btn.dataset.mode = mode;
  btn.disabled = disabled;
  btn.textContent = t(mode === 'cancel' ? 'popup_cancel' : 'popup_generate');
  btn.classList.toggle('btn-primary', mode === 'generate');
}

function renderView(view: PopupView): void {
  setMode(view.mode, view.disabled);
  switch (view.status.kind) {
    case 'progress':
      status.textContent = t('popup_progress', t(view.status.stageKey), String(view.status.percent));
      break;
    case 'notYoutube':
      status.textContent = t('popup_notYoutube');
      break;
    case 'none':
      status.textContent = '';
      break;
  }
}

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function getStatus(): Promise<ExtractionStatus | null> {
  return chrome.runtime
    .sendMessage<Msg, ExtractionStatus>({ type: 'GET_EXTRACTION_STATUS' })
    .catch(() => null);
}

async function refresh(): Promise<void> {
  const [st, tab] = await Promise.all([getStatus(), activeTab()]);
  renderView(popupView(st, !!tab?.url?.includes('youtube.com/watch')));
}

async function startExtraction(): Promise<void> {
  setMode('generate', true); // disable during the start handshake
  status.textContent = t('popup_starting');
  const tab = await activeTab();
  try {
    const res = await chrome.tabs.sendMessage<Msg, MsgResponse>(tab!.id!, { type: 'START_EXTRACTION' });
    if (!res.ok) {
      setMode('cancel', false); // already running — show the cancel action
      status.textContent = t('popup_alreadyRunning');
      return;
    }
    setMode('cancel', false);
    status.textContent = t('popup_extracting');
  } catch {
    setMode('generate', false);
    status.textContent = t('popup_connectFail');
  }
}

async function cancelExtraction(): Promise<void> {
  setMode('cancel', true); // disable during the cancel round-trip
  const res = await chrome.runtime
    .sendMessage<Msg, MsgResponse>({ type: 'CANCEL_EXTRACTION' })
    .catch(() => null);
  setMode('generate', false);
  status.textContent = res?.ok ? t('popup_cancelled') : t('popup_connectFail');
}

btn.addEventListener('click', () => {
  if (btn.dataset.mode === 'cancel') void cancelExtraction();
  else void startExtraction();
});

void refresh();
