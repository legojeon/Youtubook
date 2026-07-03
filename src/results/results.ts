import { DEFAULT_DETECT, detectScenes } from '../core/detect';
import { formatTimestamp } from '../core/format';
import { scriptForRange } from '../core/mapping';
import { repKey, type SceneRange, type SessionData } from '../core/types';
import type { Msg, MsgResponse, RepRef } from '../messages';
import { getSession, updateSession } from '../storage/db';

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
  $('#selected-count').textContent = `${selected.size}개 선택`;
  ($('#next') as HTMLButtonElement).disabled = selected.size === 0;
}

function render(): void {
  $('#video-title').textContent = session.meta.title;
  $('#scene-count').textContent = `장면 ${session.ranges.length}개`;
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
      banner('세션 저장에 실패했습니다. 페이지를 새로고침해주세요.', 'error');
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
          ? '고해상도 캡처를 하려면 원본 유튜브 영상 탭을 열어둔 상태여야 합니다. 지금은 미리보기 화질로 표시됩니다.'
          : `재캡처 실패: ${res.reason ?? '알 수 없는 오류'}`,
        'error',
      );
    }
  } finally {
    btn.disabled = false;
  }
}

// 재캡처 프레임 실시간 반영 (콘텐츠 스크립트가 브로드캐스트)
chrome.runtime.onMessage.addListener((msg: Msg) => {
  if (msg.type !== 'FRAME_READY' || msg.sessionId !== session?.meta.id) return;
  session.images[msg.key] = msg.dataUrl;
  const img = grid.querySelector<HTMLImageElement>(`.card[data-key="${msg.key}"] img`);
  if (img) img.src = msg.dataUrl;
});

export interface SelectedScene {
  range: SceneRange;
  image: string;
  script: string;
}

function getSelectedScenes(): SelectedScene[] {
  return session.ranges
    .filter(r => selected.has(repKey(r.repSec)))
    .sort((a, b) => a.startSec - b.startSec)
    .map(range => ({
      range,
      image: imageFor(range),
      script: scriptForRange(session.cues, range.startSec, range.endSec),
    }));
}
// Task 14에서 사용
void getSelectedScenes;

void (async () => {
  const id = new URLSearchParams(location.search).get('session');
  const loaded = id ? await getSession(id) : null;
  if (!loaded) {
    $('#video-title').textContent = '세션을 찾을 수 없습니다. 유튜브에서 다시 생성해주세요.';
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

  if (!session.meta.captionsAvailable) {
    banner('이 영상은 자막이 없어 장면만 추출됩니다. 대본 TXT는 제공되지 않습니다.');
  }
  if (session.meta.truncated) {
    banner('장면이 300개를 초과해 강한 전환 위주로 표시합니다. 민감도를 낮춰보세요.');
  }
  render();
})();
