import { repKey, type Cue, type SceneRange, type SessionData, type SessionMeta } from '../core/types';
import { thumbsComplete } from '../core/thumb-chunks';

const DB_NAME = 'youtubook';
const SESSION_STORE = 'sessions';
const PENDING_SESSION_STORE = 'pendingSessions';
const PENDING_FRAME_STORE = 'pendingFrames';
const PENDING_FRAME_SESSION_INDEX = 'sessionId';
const VERSION = 2;

export const MAX_PENDING_FRAME_DATA_URL_CHARS = 16 * 1024 * 1024;
export const MAX_PENDING_SESSION_IMAGE_CHARS = 128 * 1024 * 1024;

export interface PendingSessionData {
  meta: SessionMeta;
  scores: number[];
  thumbs: string[];
  cues: Cue[];
  ranges: SceneRange[];
  updatedAt: number;
}

interface PendingFrameRecord {
  sessionId: string;
  key: string;
  dataUrl: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SESSION_STORE)) {
        db.createObjectStore(SESSION_STORE, { keyPath: 'meta.id' });
      }
      if (!db.objectStoreNames.contains(PENDING_SESSION_STORE)) {
        db.createObjectStore(PENDING_SESSION_STORE, { keyPath: 'meta.id' });
      }
      if (!db.objectStoreNames.contains(PENDING_FRAME_STORE)) {
        const frames = db.createObjectStore(PENDING_FRAME_STORE, {
          keyPath: ['sessionId', 'key'],
        });
        frames.createIndex(PENDING_FRAME_SESSION_INDEX, 'sessionId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(
      transaction.error ?? new DOMException('Transaction aborted', 'AbortError'),
    );
    transaction.onerror = () => reject(transaction.error);
  });
}

async function withDb<T>(run: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await openDb();
  try {
    return await run(db);
  } finally {
    db.close();
  }
}

async function sessionTx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return withDb(async db => {
    const transaction = db.transaction(SESSION_STORE, mode);
    const result = await requestResult(fn(transaction.objectStore(SESSION_STORE)));
    await transactionDone(transaction);
    return result;
  });
}

export async function saveSession(session: SessionData): Promise<void> {
  await sessionTx('readwrite', store => store.put(session));
}

export async function getSession(id: string): Promise<SessionData | null> {
  const result = await sessionTx<SessionData | undefined>('readonly', store => store.get(id));
  return result ?? null;
}

export async function updateSession(
  id: string,
  patch: (session: SessionData) => SessionData,
): Promise<SessionData | null> {
  return withDb(async db => {
    const transaction = db.transaction(SESSION_STORE, 'readwrite');
    const store = transaction.objectStore(SESSION_STORE);
    const current = await requestResult<SessionData | undefined>(store.get(id));
    if (!current) {
      await transactionDone(transaction);
      return null;
    }
    const next = patch(current);
    await requestResult(store.put(next));
    await transactionDone(transaction);
    return next;
  });
}

function sessionsToPrune(
  all: SessionData[],
  keep: number,
  protectedId?: string,
): SessionData[] {
  const protectedSession = protectedId
    ? all.find(session => session.meta.id === protectedId)
    : undefined;
  const retained = new Set(
    all
      .filter(session => session !== protectedSession)
      .sort((a, b) => b.meta.createdAt - a.meta.createdAt)
      .slice(0, Math.max(0, keep - (protectedSession ? 1 : 0)))
      .map(session => session.meta.id),
  );
  if (protectedSession) retained.add(protectedSession.meta.id);
  return all.filter(session => !retained.has(session.meta.id));
}

export async function pruneSessions(keep: number, protectedId?: string): Promise<void> {
  const all = await sessionTx<SessionData[]>('readonly', store => store.getAll());
  const stale = sessionsToPrune(all, keep, protectedId);
  for (const session of stale) {
    await sessionTx('readwrite', store => store.delete(session.meta.id));
  }
}

export async function createPendingSession(session: PendingSessionData): Promise<void> {
  await withDb(async db => {
    const transaction = db.transaction(PENDING_SESSION_STORE, 'readwrite');
    await requestResult(transaction.objectStore(PENDING_SESSION_STORE).put(session));
    await transactionDone(transaction);
  });
}

export async function resetPendingSession(session: PendingSessionData): Promise<void> {
  await withDb(async db => {
    const transaction = db.transaction(
      [PENDING_SESSION_STORE, PENDING_FRAME_STORE],
      'readwrite',
    );
    const done = transactionDone(transaction);
    try {
      await deleteFrameRecords(transaction.objectStore(PENDING_FRAME_STORE), session.meta.id);
      await requestResult(transaction.objectStore(PENDING_SESSION_STORE).put(session));
      await done;
    } catch (error) {
      try { transaction.abort(); } catch { /* already completed or aborted */ }
      await done.catch(() => {});
      throw error;
    }
  });
}

export async function getPendingSession(id: string): Promise<PendingSessionData | null> {
  return withDb(async db => {
    const transaction = db.transaction(PENDING_SESSION_STORE, 'readonly');
    const result = await requestResult<PendingSessionData | undefined>(
      transaction.objectStore(PENDING_SESSION_STORE).get(id),
    );
    await transactionDone(transaction);
    return result ?? null;
  });
}

export async function updatePendingSession(
  id: string,
  patch: (session: PendingSessionData) => PendingSessionData,
): Promise<PendingSessionData | null> {
  return withDb(async db => {
    const transaction = db.transaction(PENDING_SESSION_STORE, 'readwrite');
    const store = transaction.objectStore(PENDING_SESSION_STORE);
    const current = await requestResult<PendingSessionData | undefined>(store.get(id));
    if (!current) {
      await transactionDone(transaction);
      return null;
    }
    const next = patch(current);
    await requestResult(store.put(next));
    await transactionDone(transaction);
    return next;
  });
}

function pendingFrameRecords(
  store: IDBObjectStore,
  sessionId: string,
): Promise<PendingFrameRecord[]> {
  return requestResult(
    store.index(PENDING_FRAME_SESSION_INDEX).getAll(IDBKeyRange.only(sessionId)),
  );
}

export function validatePendingFrameBudget(dataUrl: unknown, existingChars: number): void {
  if (typeof dataUrl !== 'string') throw new Error('Frame must be a valid JPEG data URL.');
  if (dataUrl.length > MAX_PENDING_FRAME_DATA_URL_CHARS) {
    throw new Error('Frame exceeds the per-image size limit.');
  }
  const prefix = 'data:image/jpeg;base64,';
  const payload = dataUrl.startsWith(prefix) ? dataUrl.slice(prefix.length) : '';
  if (!payload
    || payload.length % 4 !== 0
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) {
    throw new Error('Frame must be a valid JPEG data URL.');
  }
  let decoded: string;
  try {
    decoded = atob(payload);
  } catch {
    throw new Error('Frame must be a valid JPEG data URL.');
  }
  if (decoded.length < 4
    || decoded.charCodeAt(0) !== 0xff
    || decoded.charCodeAt(1) !== 0xd8
    || decoded.charCodeAt(decoded.length - 2) !== 0xff
    || decoded.charCodeAt(decoded.length - 1) !== 0xd9) {
    throw new Error('Frame must be a valid JPEG data URL.');
  }
  if (!Number.isSafeInteger(existingChars) || existingChars < 0) {
    throw new Error('Existing frame size must be a non-negative safe integer.');
  }
  if (existingChars > MAX_PENDING_SESSION_IMAGE_CHARS - dataUrl.length) {
    throw new Error('Frames exceed the aggregate session size limit.');
  }
}

export async function putPendingFrame(
  sessionId: string,
  key: string,
  dataUrl: string,
): Promise<void> {
  await withDb(async db => {
    const transaction = db.transaction(PENDING_FRAME_STORE, 'readwrite');
    const store = transaction.objectStore(PENDING_FRAME_STORE);
    const records = await pendingFrameRecords(store, sessionId);
    const existingChars = records.reduce(
      (sum, record) => sum + (record.key === key ? 0 : record.dataUrl.length),
      0,
    );
    validatePendingFrameBudget(dataUrl, existingChars);
    await requestResult(store.put({ sessionId, key, dataUrl } satisfies PendingFrameRecord));
    await transactionDone(transaction);
  });
}

export async function putPendingFrameAtomic(
  sessionId: string,
  ownerTabId: number,
  key: string,
  dataUrl: string,
  updatedAt: number,
): Promise<void> {
  await withDb(async db => {
    const transaction = db.transaction(
      [PENDING_SESSION_STORE, PENDING_FRAME_STORE],
      'readwrite',
    );
    const done = transactionDone(transaction);
    try {
      const pendingStore = transaction.objectStore(PENDING_SESSION_STORE);
      const frameStore = transaction.objectStore(PENDING_FRAME_STORE);
      const pending = await requestResult<PendingSessionData | undefined>(
        pendingStore.get(sessionId),
      );
      if (!pending) throw new Error('조립 중인 세션이 없습니다.');
      if (pending.meta.tabId !== ownerTabId) {
        throw new Error('Sender tab does not own this session.');
      }
      if (!pending.ranges.some(range => repKey(range.repSec) === key)) {
        throw new Error('Frame key is not expected for this session.');
      }
      if (!Number.isSafeInteger(updatedAt) || updatedAt < 0) {
        throw new Error('Frame timestamp must be a non-negative safe integer.');
      }
      const records = await pendingFrameRecords(frameStore, sessionId);
      const existingChars = records.reduce(
        (sum, record) => sum + (record.key === key ? 0 : record.dataUrl.length),
        0,
      );
      validatePendingFrameBudget(dataUrl, existingChars);
      await requestResult(frameStore.put({ sessionId, key, dataUrl } satisfies PendingFrameRecord));
      await requestResult(pendingStore.put({ ...pending, updatedAt }));
      await done;
    } catch (error) {
      try { transaction.abort(); } catch { /* already completed or aborted */ }
      await done.catch(() => {});
      throw error;
    }
  });
}

export async function finalizePendingSession(
  sessionId: string,
  ownerTabId: number,
  keep: number,
): Promise<SessionData> {
  return withDb(async db => {
    const transaction = db.transaction(
      [SESSION_STORE, PENDING_SESSION_STORE, PENDING_FRAME_STORE],
      'readwrite',
    );
    const done = transactionDone(transaction);
    try {
      const sessionStore = transaction.objectStore(SESSION_STORE);
      const pending = await requestResult<PendingSessionData | undefined>(
        transaction.objectStore(PENDING_SESSION_STORE).get(sessionId),
      );
      if (!pending) {
        const committed = await requestResult<SessionData | undefined>(sessionStore.get(sessionId));
        if (!committed) throw new Error('조립 중인 세션이 없습니다.');
        if (committed.meta.tabId !== ownerTabId) {
          throw new Error('Sender tab does not own this session.');
        }
        await done;
        return committed;
      }
      if (pending.meta.tabId !== ownerTabId) {
        throw new Error('Sender tab does not own this session.');
      }
      if (!thumbsComplete(pending.thumbs, pending.scores.length)) {
        throw new Error('썸네일 전송이 완료되지 않았습니다.');
      }
      const records = await pendingFrameRecords(
        transaction.objectStore(PENDING_FRAME_STORE),
        sessionId,
      );
      const images = Object.fromEntries(records.map(record => [record.key, record.dataUrl]));
      if (pending.ranges.some(range => !Object.hasOwn(images, repKey(range.repSec)))) {
        throw new Error('장면 이미지 전송이 완료되지 않았습니다.');
      }
      const { updatedAt: _updatedAt, ...withoutTimestamp } = pending;
      const finalized: SessionData = { ...withoutTimestamp, images };
      await requestResult(sessionStore.put(finalized));
      const all = await requestResult<SessionData[]>(sessionStore.getAll());
      for (const stale of sessionsToPrune(all, keep, sessionId)) {
        await requestResult(sessionStore.delete(stale.meta.id));
      }
      await done;
      return finalized;
    } catch (error) {
      try { transaction.abort(); } catch { /* already completed or aborted */ }
      await done.catch(() => {});
      throw error;
    }
  });
}

export async function getPendingFrames(sessionId: string): Promise<Record<string, string>> {
  return withDb(async db => {
    const transaction = db.transaction(PENDING_FRAME_STORE, 'readonly');
    const records = await pendingFrameRecords(transaction.objectStore(PENDING_FRAME_STORE), sessionId);
    await transactionDone(transaction);
    return Object.fromEntries(records.map(record => [record.key, record.dataUrl]));
  });
}

export async function getPendingFrameChars(sessionId: string): Promise<number> {
  const frames = await getPendingFrames(sessionId);
  return Object.values(frames).reduce((sum, dataUrl) => sum + dataUrl.length, 0);
}

function deleteFrameRecords(store: IDBObjectStore, sessionId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = store.index(PENDING_FRAME_SESSION_INDEX).openKeyCursor(
      IDBKeyRange.only(sessionId),
    );
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      store.delete(cursor.primaryKey);
      cursor.continue();
    };
  });
}

export async function deletePendingSession(sessionId: string): Promise<void> {
  await withDb(async db => {
    const transaction = db.transaction(
      [PENDING_SESSION_STORE, PENDING_FRAME_STORE],
      'readwrite',
    );
    transaction.objectStore(PENDING_SESSION_STORE).delete(sessionId);
    await deleteFrameRecords(transaction.objectStore(PENDING_FRAME_STORE), sessionId);
    await transactionDone(transaction);
  });
}

export async function deletePendingSessionsOlderThan(cutoff: number): Promise<number> {
  const sessions = await withDb(async db => {
    const transaction = db.transaction(PENDING_SESSION_STORE, 'readonly');
    const records = await requestResult<PendingSessionData[]>(
      transaction.objectStore(PENDING_SESSION_STORE).getAll(),
    );
    await transactionDone(transaction);
    return records.filter(session => session.updatedAt < cutoff);
  });
  for (const session of sessions) await deletePendingSession(session.meta.id);
  return sessions.length;
}
