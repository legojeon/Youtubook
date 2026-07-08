import { cuesToSentences } from '../core/sentences';
import { repKey } from '../core/types';
import { buildBookData, selectedScenes } from '../results/book-data';
import { resizeForBook } from '../results/image-resize';
import { BOOK_STYLE, renderBookBodyHtml, type BookData, type BookLabels } from '../results/html-book';
import { getSession } from '../storage/db';
import { applyI18n, t } from '../ui/i18n';

function bookLabels(): BookLabels {
  return { playCaption: t('book_playCaption'), openOriginal: t('book_openOriginal') };
}

/** 책 본문을 주입하고 탭 제목을 책 제목으로 바꾼다. 뷰어의 순수 렌더 단계. */
export function renderViewer(root: HTMLElement, book: BookData, labels: BookLabels): void {
  root.innerHTML = renderBookBodyHtml(book, labels);
  if (book.title) document.title = book.title;
}

async function bookViewKeys(sessionId: string, allKeys: string[]): Promise<string[]> {
  const stored = (await chrome.storage.session.get(`book:${sessionId}`))[`book:${sessionId}`];
  return Array.isArray(stored) && stored.length ? (stored as string[]) : allKeys;
}

void (async () => {
  applyI18n(document);
  const style = document.createElement('style');
  style.textContent = BOOK_STYLE;
  document.head.appendChild(style);

  const container = document.getElementById('book');
  if (!container) return; // #book 부재(예: 단위 테스트에서 이 모듈만 import) — 부작용 없이 종료

  const id = new URLSearchParams(location.search).get('session');
  const session = id ? await getSession(id) : null;
  if (!session) {
    container.textContent = t('viewer_notFound');
    return;
  }
  const allKeys = session.ranges.map(r => repKey(r.repSec));
  const keys = await bookViewKeys(session.meta.id, allKeys);
  const sentences = cuesToSentences(session.cues, session.meta.captionLang);
  const scenes = selectedScenes(session, sentences, keys);
  if (!scenes.length) {
    container.textContent = t('viewer_empty');
    return;
  }
  const book = await buildBookData(scenes, session.meta, img => resizeForBook(img, false));
  renderViewer(container, book, bookLabels());
})();
