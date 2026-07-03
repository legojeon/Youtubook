import type { Msg, MsgResponse } from '../messages';

const btn = document.getElementById('go') as HTMLButtonElement;
const status = document.getElementById('status') as HTMLParagraphElement;

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

void (async () => {
  const tab = await activeTab();
  if (!tab?.url?.includes('youtube.com/watch')) {
    btn.disabled = true;
    status.textContent = '유튜브 영상 페이지에서 실행해주세요.';
  }
})();

btn.addEventListener('click', async () => {
  btn.disabled = true;
  status.textContent = '추출을 시작합니다…';
  const tab = await activeTab();
  try {
    const res = await chrome.tabs.sendMessage<Msg, MsgResponse>(tab!.id!, { type: 'START_EXTRACTION' });
    if (!res.ok) throw new Error(res.reason);
    status.textContent = '추출 중 — 진행 상황은 영상 페이지 상단에 표시됩니다. 완료되면 결과 탭이 열립니다.';
  } catch (err) {
    status.textContent = err instanceof Error && err.message.includes('진행 중')
      ? err.message
      : '연결 실패 — 페이지를 새로고침한 뒤 다시 시도해주세요.';
    btn.disabled = false;
  }
});
