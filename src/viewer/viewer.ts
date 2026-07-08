import { cuesToSentences } from '../core/sentences';
import { repKey } from '../core/types';
import { buildBookData, selectedScenes } from '../results/book-data';
import { resizeForBook } from '../results/image-resize';
import { BOOK_STYLE, type BookLabels } from '../results/html-book';
import { getSession } from '../storage/db';
import { applyI18n, t } from '../ui/i18n';
import { renderViewer } from './viewer-view';

function bookLabels(): BookLabels {
  return { playCaption: t('book_playCaption'), openOriginal: t('book_openOriginal') };
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

  const container = document.getElementById('book') as HTMLElement;

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
