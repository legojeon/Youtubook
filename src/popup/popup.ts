import type { ExtractionStatus, Msg, MsgResponse } from '../messages';
import { applyI18n, t } from '../ui/i18n';

const btn = document.getElementById('go') as HTMLButtonElement;
const cancelBtn = document.getElementById('cancel') as HTMLButtonElement;
const status = document.getElementById('status') as HTMLParagraphElement;

applyI18n(document);

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
  if (st?.running) {
    btn.hidden = true;
    cancelBtn.hidden = false;
    status.textContent = t('popup_progress', t(st.stage), String(st.percent));
    return;
  }
  btn.hidden = false;
  cancelBtn.hidden = true;
  if (!tab?.url?.includes('youtube.com/watch')) {
    btn.disabled = true;
    status.textContent = t('popup_notYoutube');
  }
}

btn.addEventListener('click', async () => {
  btn.disabled = true;
  status.textContent = t('popup_starting');
  const tab = await activeTab();
  try {
    const res = await chrome.tabs.sendMessage<Msg, MsgResponse>(tab!.id!, { type: 'START_EXTRACTION' });
    if (!res.ok) {
      status.textContent = t('popup_alreadyRunning');
      btn.disabled = false;
      return;
    }
    status.textContent = t('popup_extracting');
  } catch {
    status.textContent = t('popup_connectFail');
    btn.disabled = false;
  }
});

cancelBtn.addEventListener('click', async () => {
  cancelBtn.disabled = true;
  const res = await chrome.runtime
    .sendMessage<Msg, MsgResponse>({ type: 'CANCEL_EXTRACTION' })
    .catch(() => null);
  cancelBtn.hidden = true;
  cancelBtn.disabled = false;
  btn.hidden = false; // restore the normal UI so a new extraction can be started
  status.textContent = res?.ok ? t('popup_cancelled') : t('popup_connectFail');
});

void refresh();
