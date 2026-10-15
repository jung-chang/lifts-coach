import { useSyncExternalStore } from 'react';
import Dexie, { type Table } from 'dexie';
import type { AppData, SyncRequest } from '../../shared/types';
import { emptyData, id, validateBackup } from '../../shared/domain';

type Meta = { key: string; value: unknown };
type OutboxItem = {
  operationId: string;
  deviceId: string;
  baseRevision: number;
  data: AppData;
  createdAt: string;
};
class LocalDb extends Dexie {
  records!: Table<{ key: string; data: AppData }, string>;
  meta!: Table<Meta, string>;
  outbox!: Table<OutboxItem, string>;
  constructor() {
    super('training-lab');
    this.version(1).stores({ records: 'key', meta: 'key', outbox: 'operationId' });
    this.version(2).stores({ records: 'key', meta: 'key', outbox: 'operationId,createdAt' });
    this.version(3).stores({ records: 'key', meta: 'key', outbox: 'operationId,baseRevision' });
  }
}
const db = new LocalDb();
type SyncStatus = 'local' | 'syncing' | 'synced' | 'offline' | 'conflict' | 'error';
type Conflict = { revision: number; data: AppData } | null;
type Snapshot = {
  data: AppData | null;
  syncStatus: SyncStatus;
  conflict: Conflict;
  pendingCount: number;
  lastSyncedAt: string | null;
};
let snapshot: Snapshot = {
  data: null,
  syncStatus: 'local',
  conflict: null,
  pendingCount: 0,
  lastSyncedAt: null,
};
const listeners = new Set<() => void>();
const publish = (next: Partial<Snapshot>) => {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((fn) => fn());
};
let initPromise: Promise<void> | undefined,
  syncPromise: Promise<void> | undefined,
  deviceId = '',
  serverAvailable = false;
export function createMutationQueue() {
  let tail = Promise.resolve();
  return <T>(task: () => Promise<T> | T): Promise<T> => {
    const result = tail.then(task);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}
const runMutation = createMutationQueue();
const getDevice = () => {
  if (deviceId) return deviceId;
  try {
    deviceId = localStorage.getItem('training-device-id') || id('device');
    localStorage.setItem('training-device-id', deviceId);
  } catch {
    deviceId = id('device');
  }
  return deviceId;
};
const revision = async () => Number((await db.meta.get('revision'))?.value ?? 0);
export function reserveBaseRevision(
  serverRevision: number,
  reservedNext: number | undefined = serverRevision,
): number {
  if (
    !Number.isInteger(serverRevision) ||
    serverRevision < 0 ||
    (reservedNext !== undefined && (!Number.isInteger(reservedNext) || reservedNext < 0))
  )
    throw new Error('Invalid revision queue state');
  return Math.max(serverRevision, reservedNext ?? serverRevision);
}

async function sendOutbox(): Promise<void> {
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    if (!navigator.onLine) {
      publish({ syncStatus: 'offline' });
      return;
    }
    if (!serverAvailable) {
      publish({ syncStatus: 'error' });
      return;
    }
    if (snapshot.conflict) return;
    publish({ syncStatus: 'syncing' });
    try {
      for (;;) {
        if (snapshot.conflict) return;
        const item = await db.outbox.orderBy('baseRevision').first();
        if (!item) break;
        const body: SyncRequest = {
          operationId: item.operationId,
          deviceId: item.deviceId,
          baseRevision: item.baseRevision,
          data: item.data,
        };
        const response = await fetch('/api/state', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (response.status === 409) {
          const remote = (await response.json()) as { data: unknown; revision: number };
          publish({
            syncStatus: 'conflict',
            conflict: { data: validateBackup(remote.data), revision: remote.revision },
          });
          return;
        }
        if (!response.ok) throw new Error(`Sync failed (${response.status})`);
        const result = (await response.json()) as { revision: number };
        const lastSyncedAt = new Date().toISOString();
        await db.transaction('rw', db.meta, db.outbox, async () => {
          await db.meta.put({ key: 'revision', value: result.revision });
          await db.outbox.delete(item.operationId);
          const pendingCount = await db.outbox.count();
          await db.meta.put({ key: 'pendingCount', value: pendingCount });
          if (pendingCount === 0)
            await db.meta.put({ key: 'reservedNext', value: result.revision });
          await db.meta.put({ key: 'lastSyncedAt', value: lastSyncedAt });
          publish({ pendingCount, lastSyncedAt });
        });
      }
      publish({ syncStatus: 'synced', conflict: null, pendingCount: await db.outbox.count() });
    } catch {
      publish({ syncStatus: navigator.onLine ? 'error' : 'offline' });
    }
  })().finally(() => {
    syncPromise = undefined;
  });
  return syncPromise;
}

async function connectRemote(): Promise<void> {
  if (!navigator.onLine) {
    publish({ syncStatus: 'offline' });
    return;
  }
  try {
    const response = await fetch('/api/state');
    if (!response.ok) {
      serverAvailable = false;
      publish({ syncStatus: 'error' });
      return;
    }
    const remote = (await response.json()) as { data: unknown; revision: number },
      valid = validateBackup(remote.data);
    serverAvailable = true;
    await runMutation(async () => {
      const storedRev = await revision(),
        queued = await db.outbox.count();
      publish({ pendingCount: queued });
      // A pull and a local edit share the same queue: a late response must not
      // replace a freshly logged set or reset its reserved outbox revision.
      if (queued || snapshot.conflict) return;
      const lastSyncedAt = new Date().toISOString();
      if (remote.revision > storedRev || !snapshot.data) {
        await db.transaction('rw', db.records, db.meta, async () => {
          await db.records.put({ key: 'app-data', data: valid });
          await db.meta.put({ key: 'revision', value: remote.revision });
          await db.meta.put({ key: 'reservedNext', value: remote.revision });
          await db.meta.put({ key: 'pendingCount', value: 0 });
          await db.meta.put({ key: 'lastSyncedAt', value: lastSyncedAt });
        });
        publish({
          data: valid,
          syncStatus: 'synced',
          conflict: null,
          pendingCount: 0,
          lastSyncedAt,
        });
      } else if (remote.revision < storedRev) {
        publish({ syncStatus: 'conflict', conflict: { data: valid, revision: remote.revision } });
      } else {
        await db.meta.put({ key: 'lastSyncedAt', value: lastSyncedAt });
        publish({ lastSyncedAt });
      }
    });
    if (!snapshot.conflict) await sendOutbox();
  } catch {
    serverAvailable = false;
    publish({ syncStatus: 'offline' });
  }
}
async function initialize(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const local = await db.records.get('app-data');
    const [pendingCount, lastSynced] = await Promise.all([
      db.outbox.count(),
      db.meta.get('lastSyncedAt'),
    ]);
    const lastSyncedAt = typeof lastSynced?.value === 'string' ? lastSynced.value : null;
    if (local)
      publish({
        data: validateBackup(local.data),
        syncStatus: 'local',
        pendingCount,
        lastSyncedAt,
      });
    else publish({ data: emptyData(), syncStatus: 'local', pendingCount, lastSyncedAt });
    // Network discovery never blocks the transaction that saves a local set.
    if (navigator.onLine) void connectRemote();
    else publish({ syncStatus: 'offline' });
  })().catch(() => publish({ syncStatus: 'error' }));
  return initPromise;
}
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void connectRemote());
  window.addEventListener('offline', () => publish({ syncStatus: 'offline' }));
}

export function useAppStore() {
  const value = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      void initialize();
      return () => listeners.delete(fn);
    },
    () => snapshot,
    () => snapshot,
  );
  const update = (updater: (data: AppData) => AppData): Promise<void> =>
    runMutation(async () => {
      await initialize();
      const current = snapshot.data ?? emptyData(),
        next = validateBackup(updater(structuredClone(current)));
      let item!: OutboxItem;
      await db.transaction('rw', db.records, db.outbox, db.meta, async () => {
        const rev = Number((await db.meta.get('revision'))?.value ?? 0),
          reserved = (await db.meta.get('reservedNext'))?.value as number | undefined,
          baseRevision = reserveBaseRevision(rev, reserved);
        item = {
          operationId: id('op'),
          deviceId: getDevice(),
          baseRevision,
          data: next,
          createdAt: new Date().toISOString(),
        };
        await db.meta.put({ key: 'reservedNext', value: baseRevision + 1 });
        await db.records.put({ key: 'app-data', data: next });
        await db.outbox.put(item);
        await db.meta.put({ key: 'pendingCount', value: await db.outbox.count() });
      });
      publish({
        data: next,
        pendingCount: await db.outbox.count(),
        syncStatus: snapshot.conflict ? 'conflict' : 'local',
      });
      if (!snapshot.conflict) void sendOutbox();
    });
  return {
    ...value,
    update,
    retrySync: async () => {
      await initialize();
      await connectRemote();
    },
    resolveConflict: async (choice: 'local' | 'remote') =>
      runMutation(async () => {
        const conflict = snapshot.conflict;
        if (!conflict) return;
        const chosen = choice === 'remote' ? conflict.data : snapshot.data;
        if (!chosen) return;
        await syncPromise;
        let item: OutboxItem | undefined;
        const resolvedAt = choice === 'remote' ? new Date().toISOString() : null;
        await db.transaction('rw', db.records, db.meta, db.outbox, async () => {
          await db.records.put({ key: 'app-data', data: chosen });
          await db.meta.put({ key: 'revision', value: conflict.revision });
          await db.meta.put({ key: 'reservedNext', value: conflict.revision });
          await db.outbox.clear();
          await db.meta.put({ key: 'pendingCount', value: 0 });
          if (resolvedAt) await db.meta.put({ key: 'lastSyncedAt', value: resolvedAt });
          if (choice === 'local') {
            item = {
              operationId: id('op'),
              deviceId: getDevice(),
              baseRevision: conflict.revision,
              data: chosen,
              createdAt: new Date().toISOString(),
            };
            await db.meta.put({ key: 'reservedNext', value: conflict.revision + 1 });
            await db.outbox.put(item);
            await db.meta.put({ key: 'pendingCount', value: 1 });
          }
        });
        publish({
          data: chosen,
          conflict: null,
          syncStatus: choice === 'remote' ? 'synced' : 'local',
          pendingCount: item ? 1 : 0,
          ...(resolvedAt ? { lastSyncedAt: resolvedAt } : {}),
        });
        if (item) void sendOutbox();
      }),
    exportData: async () => {
      await initialize();
      await runMutation(async () => undefined);
      return JSON.stringify(snapshot.data ?? emptyData(), null, 2);
    },
    importData: async (input: unknown) => {
      const imported = validateBackup(typeof input === 'string' ? JSON.parse(input) : input);
      await update(() => imported);
    },
    deleteAllData: async () =>
      runMutation(async () => {
        await initialize();
        if (!navigator.onLine)
          throw new Error('Connect to the internet before deleting cloud data.');
        await syncPromise;
        const response = await fetch('/api/state', { method: 'DELETE' });
        if (!response.ok) throw new Error(`Data deletion failed (${response.status}).`);
        const cleared = emptyData();
        const deletedAt = new Date().toISOString();
        await db.transaction('rw', db.records, db.meta, db.outbox, async () => {
          await db.records.clear();
          await db.meta.clear();
          await db.outbox.clear();
          await db.records.put({ key: 'app-data', data: cleared });
          await db.meta.bulkPut([
            { key: 'revision', value: 0 },
            { key: 'reservedNext', value: 0 },
            { key: 'pendingCount', value: 0 },
            { key: 'lastSyncedAt', value: deletedAt },
          ]);
        });
        serverAvailable = true;
        publish({
          data: cleared,
          syncStatus: 'synced',
          conflict: null,
          pendingCount: 0,
          lastSyncedAt: deletedAt,
        });
      }),
  };
}
