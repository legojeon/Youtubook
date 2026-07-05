import { repKey, type Cue, type SceneRange, type SessionData, type SessionMeta } from '../core/types';
import { thumbsComplete } from '../core/thumb-chunks';

const DB_NAME = 'youtubook';
const SESSION_STORE = 'sessions';
const PENDING_SESSION_STORE = 'pendingSessions';
const PENDING_FRAME_STORE = 'pendingFrames';
const PENDING_FRAME_SESSION_INDEX = 'sessionId';
const PENDING_USAGE_STORE = 'pendingUsage';
const PENDING_STATE_STORE = 'pendingState';
const PENDING_USAGE_STATE_KEY = 'usage';
const VERSION = 3;

export const MAX_PENDING_FRAME_DATA_URL_CHARS = 16 * 1024 * 1024;
export const MAX_PENDING_SESSION_IMAGE_CHARS = 128 * 1024 * 1024;
// The global payload budget is twice the per-session image ceiling; metadata
// shares that budget. The count bound separately limits metadata-only sessions.
export const MAX_PENDING_SESSIONS = 8;
export const MAX_PENDING_PAYLOAD_BYTES = 256 * 1024 * 1024;

export interface PendingStorageLimits {
  maxPendingSessions: number;
  maxPendingPayloadBytes: number;
}

const DEFAULT_PENDING_STORAGE_LIMITS: PendingStorageLimits = {
  maxPendingSessions: MAX_PENDING_SESSIONS,
  maxPendingPayloadBytes: MAX_PENDING_PAYLOAD_BYTES,
};

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

export interface PendingUsage {
  metadataBytes: number;
  frameBytes: number;
  totalBytes: number;
}

interface PendingUsageRecord extends PendingUsage {
  sessionId: string;
}

interface PendingUsageState {
  key: typeof PENDING_USAGE_STATE_KEY;
  totalBytes: number;
  reconciled: true;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = event => {
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
      if (!db.objectStoreNames.contains(PENDING_USAGE_STORE)) {
        db.createObjectStore(PENDING_USAGE_STORE, { keyPath: 'sessionId' });
      }
      const stateStore = db.objectStoreNames.contains(PENDING_STATE_STORE)
        ? (req.transaction as IDBTransaction).objectStore(PENDING_STATE_STORE)
        : db.createObjectStore(PENDING_STATE_STORE, { keyPath: 'key' });
      // Versions before v2 cannot contain pending payloads. Marking their new
      // counter stores reconciled avoids an unnecessary first-write scan. A
      // v2 database may contain pending sessions/frames and must rebuild once.
      if (event.oldVersion < 2) {
        stateStore.put({
          key: PENDING_USAGE_STATE_KEY,
          totalBytes: 0,
          reconciled: true,
        } satisfies PendingUsageState);
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
  await resetPendingSession(session, 0);
}

function validatePendingStorageLimits(limits: PendingStorageLimits): void {
  if (!Number.isSafeInteger(limits.maxPendingSessions) || limits.maxPendingSessions < 1) {
    throw new Error('Pending session count limit must be a positive safe integer.');
  }
  if (!Number.isSafeInteger(limits.maxPendingPayloadBytes)
    || limits.maxPendingPayloadBytes < 1) {
    throw new Error('Pending payload byte limit must be a positive safe integer.');
  }
}

function storedStringBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function pendingSessionBytes(session: PendingSessionData): number {
  return storedStringBytes(JSON.stringify(session));
}

function leastRecentlyUpdated(a: PendingSessionData, b: PendingSessionData): number {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt - b.updatedAt;
  return a.meta.id < b.meta.id ? -1 : a.meta.id > b.meta.id ? 1 : 0;
}

function usageTotal(metadataBytes: number, frameBytes: number): number {
  if (!Number.isSafeInteger(metadataBytes) || metadataBytes < 0
    || !Number.isSafeInteger(frameBytes) || frameBytes < 0
    || metadataBytes > Number.MAX_SAFE_INTEGER - frameBytes) {
    throw new Error('Pending payload counters are invalid.');
  }
  return metadataBytes + frameBytes;
}

function nextAggregateBytes(totalBytes: number, removedBytes: number, addedBytes: number): number {
  if (!Number.isSafeInteger(totalBytes) || totalBytes < 0
    || !Number.isSafeInteger(removedBytes) || removedBytes < 0
    || !Number.isSafeInteger(addedBytes) || addedBytes < 0
    || removedBytes > totalBytes
    || totalBytes - removedBytes > Number.MAX_SAFE_INTEGER - addedBytes) {
    throw new Error('Pending payload counters are invalid.');
  }
  return totalBytes - removedBytes + addedBytes;
}

function usageRecord(
  sessionId: string,
  metadataBytes: number,
  frameBytes: number,
): PendingUsageRecord {
  return { sessionId, metadataBytes, frameBytes, totalBytes: usageTotal(metadataBytes, frameBytes) };
}

async function rebuildPendingUsage(
  transaction: IDBTransaction,
  protectedId: string | undefined,
  limits: PendingStorageLimits,
): Promise<PendingUsageState> {
  const pendingStore = transaction.objectStore(PENDING_SESSION_STORE);
  const frameStore = transaction.objectStore(PENDING_FRAME_STORE);
  const usageStore = transaction.objectStore(PENDING_USAGE_STORE);
  const stateStore = transaction.objectStore(PENDING_STATE_STORE);
  const sessions = await requestResult<PendingSessionData[]>(pendingStore.getAll());
  const frames = await requestResult<PendingFrameRecord[]>(frameStore.getAll());
  const sessionIds = new Set(sessions.map(session => session.meta.id));
  const frameBytes = new Map<string, number>();
  for (const frame of frames) {
    if (!sessionIds.has(frame.sessionId)) {
      await requestResult(frameStore.delete([frame.sessionId, frame.key]));
      continue;
    }
    frameBytes.set(
      frame.sessionId,
      usageTotal(frameBytes.get(frame.sessionId) ?? 0, storedStringBytes(frame.dataUrl)),
    );
  }

  const usageById = new Map(sessions.map(session => {
    const usage = usageRecord(
      session.meta.id,
      pendingSessionBytes(session),
      frameBytes.get(session.meta.id) ?? 0,
    );
    return [session.meta.id, usage] as const;
  }));
  const retained = [...sessions];
  let totalBytes = [...usageById.values()].reduce(
    (sum, usage) => usageTotal(sum, usage.totalBytes),
    0,
  );
  const candidates = retained
    .filter(session => session.meta.id !== protectedId)
    .sort(leastRecentlyUpdated);
  const evicted = new Set<string>();
  while (retained.length - evicted.size > limits.maxPendingSessions
    || totalBytes > limits.maxPendingPayloadBytes) {
    const stale = candidates.shift();
    if (!stale) break;
    evicted.add(stale.meta.id);
    totalBytes = nextAggregateBytes(
      totalBytes,
      (usageById.get(stale.meta.id) as PendingUsageRecord).totalBytes,
      0,
    );
  }

  await requestResult(usageStore.clear());
  for (const session of sessions) {
    if (evicted.has(session.meta.id)) {
      await requestResult(pendingStore.delete(session.meta.id));
      await deleteFrameRecords(frameStore, session.meta.id);
      continue;
    }
    await requestResult(usageStore.put(usageById.get(session.meta.id) as PendingUsageRecord));
  }
  const state: PendingUsageState = {
    key: PENDING_USAGE_STATE_KEY,
    totalBytes,
    reconciled: true,
  };
  await requestResult(stateStore.put(state));
  return state;
}

async function ensurePendingUsage(
  transaction: IDBTransaction,
  protectedId: string | undefined,
  limits: PendingStorageLimits,
): Promise<PendingUsageState> {
  const state = await requestResult<PendingUsageState | undefined>(
    transaction.objectStore(PENDING_STATE_STORE).get(PENDING_USAGE_STATE_KEY),
  );
  if (state?.reconciled === true
    && Number.isSafeInteger(state.totalBytes)
    && state.totalBytes >= 0) {
    return state;
  }
  return rebuildPendingUsage(transaction, protectedId, limits);
}

function assertPendingPayloadFits(bytes: number, limits: PendingStorageLimits): void {
  if (bytes > limits.maxPendingPayloadBytes) {
    throw new Error('Write exceeds the aggregate pending payload byte limit.');
  }
}

export async function resetPendingSession(
  session: PendingSessionData,
  expiredBefore = 0,
  limits: PendingStorageLimits = DEFAULT_PENDING_STORAGE_LIMITS,
): Promise<void> {
  validatePendingStorageLimits(limits);
  if (!Number.isSafeInteger(expiredBefore) || expiredBefore < 0) {
    throw new Error('Pending expiration cutoff must be a non-negative safe integer.');
  }
  await withDb(async db => {
    const transaction = db.transaction(
      [
        PENDING_SESSION_STORE,
        PENDING_FRAME_STORE,
        PENDING_USAGE_STORE,
        PENDING_STATE_STORE,
      ],
      'readwrite',
    );
    const done = transactionDone(transaction);
    try {
      const pendingStore = transaction.objectStore(PENDING_SESSION_STORE);
      const frameStore = transaction.objectStore(PENDING_FRAME_STORE);
      const usageStore = transaction.objectStore(PENDING_USAGE_STORE);
      const stateStore = transaction.objectStore(PENDING_STATE_STORE);
      const state = await ensurePendingUsage(transaction, session.meta.id, limits);
      const allSessions = await requestResult<PendingSessionData[]>(pendingStore.getAll());
      const allUsage = await requestResult<PendingUsageRecord[]>(usageStore.getAll());
      const usageById = new Map(allUsage.map(usage => [usage.sessionId, usage]));
      const currentUsage = usageById.get(session.meta.id);
      const metadataBytes = pendingSessionBytes(session);
      const evicted = new Set(
        allSessions
          .filter(candidate => candidate.meta.id !== session.meta.id
            && candidate.updatedAt < expiredBefore)
          .map(candidate => candidate.meta.id),
      );
      const remaining = allSessions
        .filter(candidate => candidate.meta.id !== session.meta.id
          && !evicted.has(candidate.meta.id))
        .sort(leastRecentlyUpdated);

      while (remaining.length + 1 > limits.maxPendingSessions) {
        evicted.add((remaining.shift() as PendingSessionData).meta.id);
      }

      let nextTotal = nextAggregateBytes(
        state.totalBytes,
        currentUsage?.totalBytes ?? 0,
        metadataBytes,
      );
      for (const id of evicted) {
        nextTotal = nextAggregateBytes(
          nextTotal,
          (usageById.get(id) as PendingUsageRecord).totalBytes,
          0,
        );
      }
      while (remaining.length > 0 && nextTotal > limits.maxPendingPayloadBytes) {
        const stale = remaining.shift() as PendingSessionData;
        evicted.add(stale.meta.id);
        nextTotal = nextAggregateBytes(
          nextTotal,
          (usageById.get(stale.meta.id) as PendingUsageRecord).totalBytes,
          0,
        );
      }
      assertPendingPayloadFits(nextTotal, limits);

      await deleteFrameRecords(frameStore, session.meta.id);
      if (currentUsage) await requestResult(usageStore.delete(session.meta.id));
      for (const id of evicted) {
        await requestResult(pendingStore.delete(id));
        await deleteFrameRecords(frameStore, id);
        await requestResult(usageStore.delete(id));
      }
      await requestResult(pendingStore.put(session));
      await requestResult(usageStore.put(usageRecord(
        session.meta.id,
        metadataBytes,
        0,
      )));
      await requestResult(stateStore.put({ ...state, totalBytes: nextTotal }));
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
  limits: PendingStorageLimits = DEFAULT_PENDING_STORAGE_LIMITS,
): Promise<PendingSessionData | null> {
  validatePendingStorageLimits(limits);
  return withDb(async db => {
    const transaction = db.transaction(
      [
        PENDING_SESSION_STORE,
        PENDING_FRAME_STORE,
        PENDING_USAGE_STORE,
        PENDING_STATE_STORE,
      ],
      'readwrite',
    );
    const store = transaction.objectStore(PENDING_SESSION_STORE);
    const usageStore = transaction.objectStore(PENDING_USAGE_STORE);
    const stateStore = transaction.objectStore(PENDING_STATE_STORE);
    const state = await ensurePendingUsage(transaction, id, limits);
    const current = await requestResult<PendingSessionData | undefined>(store.get(id));
    if (!current) {
      await transactionDone(transaction);
      return null;
    }
    const next = patch(current);
    if (next.meta.id !== id) throw new Error('Pending session ID cannot be changed.');
    const usage = await requestResult<PendingUsageRecord | undefined>(usageStore.get(id));
    if (!usage) throw new Error('Pending payload counters are missing.');
    const nextMetadataBytes = pendingSessionBytes(next);
    const nextTotal = nextAggregateBytes(
      state.totalBytes,
      usage.metadataBytes,
      nextMetadataBytes,
    );
    assertPendingPayloadFits(nextTotal, limits);
    await requestResult(store.put(next));
    await requestResult(usageStore.put(usageRecord(id, nextMetadataBytes, usage.frameBytes)));
    await requestResult(stateStore.put({ ...state, totalBytes: nextTotal }));
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
  limits: PendingStorageLimits = DEFAULT_PENDING_STORAGE_LIMITS,
): Promise<void> {
  validatePendingStorageLimits(limits);
  await withDb(async db => {
    const transaction = db.transaction(
      [
        PENDING_SESSION_STORE,
        PENDING_FRAME_STORE,
        PENDING_USAGE_STORE,
        PENDING_STATE_STORE,
      ],
      'readwrite',
    );
    const pendingStore = transaction.objectStore(PENDING_SESSION_STORE);
    const frameStore = transaction.objectStore(PENDING_FRAME_STORE);
    const usageStore = transaction.objectStore(PENDING_USAGE_STORE);
    const stateStore = transaction.objectStore(PENDING_STATE_STORE);
    const state = await ensurePendingUsage(transaction, sessionId, limits);
    const pending = await requestResult<PendingSessionData | undefined>(pendingStore.get(sessionId));
    if (!pending) throw new Error('조립 중인 세션이 없습니다.');
    const usage = await requestResult<PendingUsageRecord | undefined>(usageStore.get(sessionId));
    if (!usage) throw new Error('Pending payload counters are missing.');
    const existing = await requestResult<PendingFrameRecord | undefined>(
      frameStore.get([sessionId, key]),
    );
    const existingBytes = existing ? storedStringBytes(existing.dataUrl) : 0;
    const existingChars = usage.frameBytes - existingBytes;
    validatePendingFrameBudget(dataUrl, existingChars);
    const dataUrlBytes = storedStringBytes(dataUrl);
    const frameBytes = usageTotal(existingChars, dataUrlBytes);
    const nextTotal = nextAggregateBytes(
      state.totalBytes,
      existingBytes,
      dataUrlBytes,
    );
    assertPendingPayloadFits(nextTotal, limits);
    await requestResult(frameStore.put({ sessionId, key, dataUrl } satisfies PendingFrameRecord));
    await requestResult(usageStore.put(usageRecord(sessionId, usage.metadataBytes, frameBytes)));
    await requestResult(stateStore.put({ ...state, totalBytes: nextTotal }));
    await transactionDone(transaction);
  });
}

export async function putPendingFrameAtomic(
  sessionId: string,
  ownerTabId: number,
  key: string,
  dataUrl: string,
  updatedAt: number,
  limits: PendingStorageLimits = DEFAULT_PENDING_STORAGE_LIMITS,
): Promise<void> {
  validatePendingStorageLimits(limits);
  await withDb(async db => {
    const transaction = db.transaction(
      [
        PENDING_SESSION_STORE,
        PENDING_FRAME_STORE,
        PENDING_USAGE_STORE,
        PENDING_STATE_STORE,
      ],
      'readwrite',
    );
    const done = transactionDone(transaction);
    try {
      const pendingStore = transaction.objectStore(PENDING_SESSION_STORE);
      const frameStore = transaction.objectStore(PENDING_FRAME_STORE);
      const usageStore = transaction.objectStore(PENDING_USAGE_STORE);
      const stateStore = transaction.objectStore(PENDING_STATE_STORE);
      const state = await ensurePendingUsage(transaction, sessionId, limits);
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
      const usage = await requestResult<PendingUsageRecord | undefined>(usageStore.get(sessionId));
      if (!usage) throw new Error('Pending payload counters are missing.');
      const existing = await requestResult<PendingFrameRecord | undefined>(
        frameStore.get([sessionId, key]),
      );
      const existingBytes = existing ? storedStringBytes(existing.dataUrl) : 0;
      const existingChars = usage.frameBytes - existingBytes;
      validatePendingFrameBudget(dataUrl, existingChars);
      const updatedPending = { ...pending, updatedAt };
      const nextMetadataBytes = pendingSessionBytes(updatedPending);
      const dataUrlBytes = storedStringBytes(dataUrl);
      const nextFrameBytes = usageTotal(existingChars, dataUrlBytes);
      const nextUsage = usageRecord(sessionId, nextMetadataBytes, nextFrameBytes);
      const nextTotal = nextAggregateBytes(state.totalBytes, usage.totalBytes, nextUsage.totalBytes);
      assertPendingPayloadFits(nextTotal, limits);
      await requestResult(frameStore.put({ sessionId, key, dataUrl } satisfies PendingFrameRecord));
      await requestResult(pendingStore.put(updatedPending));
      await requestResult(usageStore.put(nextUsage));
      await requestResult(stateStore.put({ ...state, totalBytes: nextTotal }));
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
      [
        SESSION_STORE,
        PENDING_SESSION_STORE,
        PENDING_FRAME_STORE,
        PENDING_USAGE_STORE,
        PENDING_STATE_STORE,
      ],
      'readwrite',
    );
    const done = transactionDone(transaction);
    try {
      const sessionStore = transaction.objectStore(SESSION_STORE);
      await ensurePendingUsage(transaction, sessionId, DEFAULT_PENDING_STORAGE_LIMITS);
      const committed = await requestResult<SessionData | undefined>(sessionStore.get(sessionId));
      if (committed) {
        if (committed.meta.tabId !== ownerTabId) {
          throw new Error('Sender tab does not own this session.');
        }
        await done;
        return committed;
      }
      const pending = await requestResult<PendingSessionData | undefined>(
        transaction.objectStore(PENDING_SESSION_STORE).get(sessionId),
      );
      if (!pending) {
        throw new Error('조립 중인 세션이 없습니다.');
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

export async function getPendingUsage(sessionId: string): Promise<PendingUsage | null> {
  return withDb(async db => {
    const transaction = db.transaction(PENDING_USAGE_STORE, 'readonly');
    const record = await requestResult<PendingUsageRecord | undefined>(
      transaction.objectStore(PENDING_USAGE_STORE).get(sessionId),
    );
    await transactionDone(transaction);
    if (!record) return null;
    const { sessionId: _sessionId, ...usage } = record;
    return usage;
  });
}

export async function getPendingAggregatePayloadBytes(): Promise<number> {
  return withDb(async db => {
    const transaction = db.transaction(PENDING_STATE_STORE, 'readonly');
    const state = await requestResult<PendingUsageState | undefined>(
      transaction.objectStore(PENDING_STATE_STORE).get(PENDING_USAGE_STATE_KEY),
    );
    await transactionDone(transaction);
    return state?.totalBytes ?? 0;
  });
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
      [
        PENDING_SESSION_STORE,
        PENDING_FRAME_STORE,
        PENDING_USAGE_STORE,
        PENDING_STATE_STORE,
      ],
      'readwrite',
    );
    const usageStore = transaction.objectStore(PENDING_USAGE_STORE);
    const stateStore = transaction.objectStore(PENDING_STATE_STORE);
    const state = await ensurePendingUsage(
      transaction,
      sessionId,
      DEFAULT_PENDING_STORAGE_LIMITS,
    );
    const usage = await requestResult<PendingUsageRecord | undefined>(usageStore.get(sessionId));
    await requestResult(transaction.objectStore(PENDING_SESSION_STORE).delete(sessionId));
    await deleteFrameRecords(transaction.objectStore(PENDING_FRAME_STORE), sessionId);
    if (usage) {
      await requestResult(usageStore.delete(sessionId));
      await requestResult(stateStore.put({
        ...state,
        totalBytes: nextAggregateBytes(state.totalBytes, usage.totalBytes, 0),
      }));
    }
    await transactionDone(transaction);
  });
}
