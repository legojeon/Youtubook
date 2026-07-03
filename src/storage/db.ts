import type { SessionData } from '../core/types';

const DB_NAME = 'youtubook';
const STORE = 'sessions';
const VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'meta.id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      t.onabort = () => reject(t.error ?? new DOMException('Transaction aborted', 'AbortError'));
      t.onerror = () => reject(t.error);
      const req = fn(t.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function saveSession(s: SessionData): Promise<void> {
  await tx('readwrite', st => st.put(s));
}

export async function getSession(id: string): Promise<SessionData | null> {
  const r = await tx<SessionData | undefined>('readonly', st => st.get(id));
  return r ?? null;
}

export async function updateSession(
  id: string,
  patch: (s: SessionData) => SessionData,
): Promise<SessionData | null> {
  const cur = await getSession(id);
  if (!cur) return null;
  const next = patch(cur);
  await saveSession(next);
  return next;
}

export async function pruneSessions(keep: number): Promise<void> {
  const all = await tx<SessionData[]>('readonly', st => st.getAll());
  const stale = all.sort((a, b) => b.meta.createdAt - a.meta.createdAt).slice(keep);
  for (const s of stale) await tx('readwrite', st => st.delete(s.meta.id));
}
