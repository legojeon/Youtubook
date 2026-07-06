import type { Msg, MsgResponse } from '../messages';
import { applyI18n, t } from '../ui/i18n';

const btn = document.getElementById('go') as HTMLButtonElement;
const status = document.getElementById('status') as HTMLParagraphElement;

applyI18n(document);

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

void (async () => {
  const tab = await activeTab();
  if (!tab?.url?.includes('youtube.com/watch')) {
    btn.disabled = true;
    status.textContent = t('popup_notYoutube');
  }
})();

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
