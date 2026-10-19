import { useSyncExternalStore } from 'react';
import Dexie, { type Table } from 'dexie';
import type { AppData, SyncRequest } from '../../shared/types';
import type { AccountSession } from '../../shared/community';
import { emptyData, id, validateBackup } from '../../shared/domain';

type Meta = { key: string; value: unknown };
type OutboxItem = {
  operationId: string;
  deviceId: string;
  baseRevision: number;
  data: AppData;
  createdAt: string;
  accountId: string | null;
  restore?: boolean;
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
    this.version(4).stores({
      records: 'key',
      meta: 'key',
      outbox: 'operationId,baseRevision,accountId',
    });
  }
}
const db = new LocalDb();
type SyncStatus = 'local' | 'syncing' | 'synced' | 'offline' | 'conflict' | 'error';
type Conflict = { revision: number; data: AppData } | null;
export type IdentityStatus = 'verified' | 'offline' | 'local' | 'unverified' | 'switch-required';
type Snapshot = {
  data: AppData | null;
  syncStatus: SyncStatus;
  conflict: Conflict;
  pendingCount: number;
  lastSyncedAt: string | null;
  session: AccountSession | null;
  identityStatus: IdentityStatus;
  legacyAvailable: boolean;
};
let snapshot: Snapshot = {
  data: null,
  syncStatus: 'local',
  conflict: null,
  pendingCount: 0,
  lastSyncedAt: null,
  session: null,
  identityStatus: 'local',
  legacyAvailable: false,
};
const listeners = new Set<() => void>();
const publish = (next: Partial<Snapshot>) => {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((fn) => fn());
};
let initPromise: Promise<void> | undefined,
  syncPromise: Promise<void> | undefined,
  deviceId = '',
  serverAvailable = false,
  generation = 0,
  sessionReadGeneration = 0,
  requestedAccount: string | null = null;
const keyPrefix = (accountId: string | null) => (accountId ? `account:${accountId}:` : 'local:');
const recordKey = (accountId: string | null) => `${keyPrefix(accountId)}app-data`;
const metaKey = (accountId: string | null, key: string) => `${keyPrefix(accountId)}${key}`;
const runMutation = (() => {
  let tail = Promise.resolve();
  return <T>(task: () => Promise<T> | T): Promise<T> => {
    const result = tail.then(task);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
})();
export function createMutationQueue() {
  return runMutation;
}
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
const revision = async (accountId = requestedAccount) =>
  Number((await db.meta.get(metaKey(accountId, 'revision')))?.value ?? 0);
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
function isCurrent(accountId: string | null, turn: number) {
  return generation === turn && requestedAccount === accountId;
}
function publishIfCurrent(accountId: string | null, turn: number, value: Partial<Snapshot>) {
  if (isCurrent(accountId, turn)) publish(value);
}
async function readSession(): Promise<{
  session: AccountSession | null;
  identityStatus: IdentityStatus;
  sequence: number;
}> {
  const sequence = ++sessionReadGeneration;
  const stale = () => sequence !== sessionReadGeneration;
  try {
    const response = await fetch('/api/session');
    if (response.status === 401 || response.status === 403) {
      try {
        localStorage.removeItem('training-verified-account');
      } catch {
        /* optional offline hint */
      }
      return { session: null, identityStatus: stale() ? 'unverified' : 'local', sequence };
    }
    if (!response.ok) return { session: null, identityStatus: 'unverified', sequence };
    const session = (await response.json()) as AccountSession;
    if (stale()) return { session: null, identityStatus: 'unverified', sequence };
    if (!session?.accountId) return { session: null, identityStatus: 'unverified', sequence };
    try {
      localStorage.setItem('training-verified-account', session.accountId);
    } catch {
      /* optional offline hint */
    }
    return { session, identityStatus: 'verified', sequence };
  } catch {
    if (stale()) return { session: null, identityStatus: 'unverified', sequence };
    let cached: string | null = null;
    try {
      cached = localStorage.getItem('training-verified-account');
    } catch {
      /* unavailable */
    }
    return cached
      ? { session: null, identityStatus: 'offline', sequence }
      : { session: null, identityStatus: 'local', sequence };
  }
}
async function activateAccount(session: AccountSession | null, identityStatus: IdentityStatus) {
  const next =
    session?.accountId ??
    (identityStatus === 'offline'
      ? (() => {
          try {
            return localStorage.getItem('training-verified-account');
          } catch {
            return null;
          }
        })()
      : null);
  if (requestedAccount !== next) {
    generation++;
    requestedAccount = next;
    syncPromise = undefined;
    serverAvailable = false;
    const turn = generation;
    const [local, pending, synced, legacy] = await Promise.all([
      db.records.get(recordKey(next)),
      db.outbox.filter((item) => item.accountId === next).count(),
      db.meta.get(metaKey(next, 'lastSyncedAt')),
      db.records.get('app-data'),
    ]);
    if (!isCurrent(next, turn)) return;
    const lastSyncedAt = typeof synced?.value === 'string' ? synced.value : null;
    publish({
      session,
      identityStatus,
      data: local ? validateBackup(local.data) : emptyData(),
      syncStatus: identityStatus === 'offline' ? 'offline' : 'local',
      conflict: null,
      pendingCount: pending,
      lastSyncedAt,
      legacyAvailable: Boolean(legacy),
    });
  } else publish({ session, identityStatus });
}
async function sendOutbox(): Promise<void> {
  const accountId = requestedAccount,
    turn = generation;
  if (syncPromise) return syncPromise;
  if (!accountId || snapshot.identityStatus !== 'verified') return;
  syncPromise = (async () => {
    if (!navigator.onLine) {
      publishIfCurrent(accountId, turn, { syncStatus: 'offline' });
      return;
    }
    try {
      // Revalidate immediately before sending so a stale tab cannot post A data with B credentials.
      const auth = await readSession();
      if (auth.sequence !== sessionReadGeneration || !isCurrent(accountId, turn)) return;
      if (auth.session?.accountId !== accountId) {
        await activateAccount(auth.session, auth.identityStatus);
        if (auth.session && navigator.onLine) void connectRemote();
        return;
      }
      if (!serverAvailable || snapshot.conflict) return;
      publishIfCurrent(accountId, turn, { syncStatus: 'syncing' });
      for (;;) {
        if (!isCurrent(accountId, turn) || snapshot.conflict) return;
        const item = await db.outbox
          .where('accountId')
          .equals(accountId)
          .sortBy('baseRevision')
          .then((items) => items[0]);
        if (!item) break;
        const beforeWrite = await readSession();
        if (beforeWrite.sequence !== sessionReadGeneration || !isCurrent(accountId, turn)) return;
        if (beforeWrite.session?.accountId !== accountId) {
          await activateAccount(beforeWrite.session, beforeWrite.identityStatus);
          if (beforeWrite.session && navigator.onLine) void connectRemote();
          return;
        }
        const body = {
          operationId: item.operationId,
          deviceId: item.deviceId,
          baseRevision: item.baseRevision,
          data: item.data,
          accountId,
          ...(item.restore ? { restore: true } : {}),
        } as SyncRequest;
        const response = await fetch('/api/state', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!isCurrent(accountId, turn)) return;
        if (response.status === 409) {
          const remote = (await response.json()) as { data: unknown; revision: number };
          publishIfCurrent(accountId, turn, {
            syncStatus: 'conflict',
            conflict: { data: validateBackup(remote.data), revision: remote.revision },
          });
          return;
        }
        if (!response.ok) throw new Error(`Sync failed (${response.status})`);
        const result = (await response.json()) as { revision: number },
          lastSyncedAt = new Date().toISOString();
        await db.transaction('rw', db.meta, db.outbox, async () => {
          await db.meta.put({ key: metaKey(accountId, 'revision'), value: result.revision });
          await db.outbox.delete(item.operationId);
          const pendingCount = await db.outbox.where('accountId').equals(accountId).count();
          await db.meta.put({ key: metaKey(accountId, 'pendingCount'), value: pendingCount });
          if (!pendingCount)
            await db.meta.put({ key: metaKey(accountId, 'reservedNext'), value: result.revision });
          await db.meta.put({ key: metaKey(accountId, 'lastSyncedAt'), value: lastSyncedAt });
          publishIfCurrent(accountId, turn, { pendingCount, lastSyncedAt });
        });
      }
      publishIfCurrent(accountId, turn, {
        syncStatus: 'synced',
        conflict: null,
        pendingCount: await db.outbox.where('accountId').equals(accountId).count(),
      });
    } catch {
      publishIfCurrent(accountId, turn, { syncStatus: navigator.onLine ? 'error' : 'offline' });
    }
  })().finally(() => {
    if (isCurrent(accountId, turn)) syncPromise = undefined;
  });
  return syncPromise;
}
async function connectRemote(): Promise<void> {
  if (!navigator.onLine) {
    publish({ syncStatus: 'offline' });
    return;
  }
  const accountId = requestedAccount,
    turn = generation;
  try {
    const auth = await readSession();
    if (auth.sequence !== sessionReadGeneration || !isCurrent(accountId, turn)) return;
    if (auth.session?.accountId !== accountId) {
      await activateAccount(auth.session, auth.identityStatus);
      if (auth.session) void connectRemote();
      return;
    }
    if (!accountId || auth.identityStatus !== 'verified') {
      publishIfCurrent(accountId, turn, {
        identityStatus: auth.identityStatus,
        syncStatus: auth.identityStatus === 'offline' ? 'offline' : 'local',
      });
      return;
    }
    const response = await fetch('/api/state', {
      headers: { 'X-Lifts-Account': accountId },
    });
    if (!isCurrent(accountId, turn)) return;
    if (!response.ok) {
      serverAvailable = false;
      publishIfCurrent(accountId, turn, {
        syncStatus: response.status === 401 ? 'error' : 'error',
      });
      return;
    }
    const remote = (await response.json()) as { data: unknown; revision: number },
      valid = validateBackup(remote.data);
    serverAvailable = true;
    await runMutation(async () => {
      if (!isCurrent(accountId, turn)) return;
      const storedRev = await revision(accountId),
        queued = await db.outbox.where('accountId').equals(accountId).count();
      publishIfCurrent(accountId, turn, { pendingCount: queued });
      if (queued || snapshot.conflict) return;
      const lastSyncedAt = new Date().toISOString();
      if (remote.revision > storedRev || !snapshot.data) {
        await db.transaction('rw', db.records, db.meta, async () => {
          await db.records.put({ key: recordKey(accountId), data: valid });
          await db.meta.bulkPut([
            { key: metaKey(accountId, 'revision'), value: remote.revision },
            { key: metaKey(accountId, 'reservedNext'), value: remote.revision },
            { key: metaKey(accountId, 'pendingCount'), value: 0 },
            { key: metaKey(accountId, 'lastSyncedAt'), value: lastSyncedAt },
          ]);
        });
        publishIfCurrent(accountId, turn, {
          data: valid,
          syncStatus: 'synced',
          conflict: null,
          pendingCount: 0,
          lastSyncedAt,
        });
      } else if (remote.revision < storedRev)
        publishIfCurrent(accountId, turn, {
          syncStatus: 'conflict',
          conflict: { data: valid, revision: remote.revision },
        });
      else {
        await db.meta.put({ key: metaKey(accountId, 'lastSyncedAt'), value: lastSyncedAt });
        publishIfCurrent(accountId, turn, { lastSyncedAt });
      }
    });
    if (!snapshot.conflict) await sendOutbox();
  } catch {
    serverAvailable = false;
    publishIfCurrent(accountId, turn, { syncStatus: 'offline' });
  }
}
async function initialize(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const auth = await readSession();
    if (auth.sequence !== sessionReadGeneration) return;
    await activateAccount(auth.session, auth.identityStatus);
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
  const update = async (updater: (data: AppData) => AppData, restore = false): Promise<void> => {
    await initialize();
    const intendedAccount = requestedAccount,
      intendedGeneration = generation;
    return runMutation(async () => {
      if (!isCurrent(intendedAccount, intendedGeneration)) return;
      const accountId = requestedAccount,
        turn = generation;
      const current = snapshot.data ?? emptyData(),
        next = validateBackup(updater(structuredClone(current)));
      if (!isCurrent(accountId, turn)) return;
      let item!: OutboxItem;
      await db.transaction('rw', db.records, db.outbox, db.meta, async () => {
        const rev = Number((await db.meta.get(metaKey(accountId, 'revision')))?.value ?? 0),
          reserved = (await db.meta.get(metaKey(accountId, 'reservedNext')))?.value as
            | number
            | undefined,
          baseRevision = reserveBaseRevision(rev, reserved);
        item = {
          operationId: id('op'),
          deviceId: getDevice(),
          baseRevision,
          data: next,
          createdAt: new Date().toISOString(),
          accountId,
          ...(restore ? { restore: true } : {}),
        };
        await db.meta.put({ key: metaKey(accountId, 'reservedNext'), value: baseRevision + 1 });
        await db.records.put({ key: recordKey(accountId), data: next });
        await db.outbox.put(item);
        await db.meta.put({
          key: metaKey(accountId, 'pendingCount'),
          value: await db.outbox.filter((outbox) => outbox.accountId === accountId).count(),
        });
      });
      publishIfCurrent(accountId, turn, {
        data: next,
        pendingCount: await db.outbox.filter((outbox) => outbox.accountId === accountId).count(),
        syncStatus: snapshot.conflict ? 'conflict' : 'local',
      });
      if (!snapshot.conflict && accountId && snapshot.identityStatus === 'verified')
        void sendOutbox();
    });
  };
  return {
    ...value,
    update,
    refreshSession: async () => {
      const auth = await readSession();
      if (auth.sequence !== sessionReadGeneration) return;
      await activateAccount(auth.session, auth.identityStatus);
      if (auth.session && navigator.onLine) await connectRemote();
    },
    refreshAccount: async () => {
      const auth = await readSession();
      if (auth.sequence !== sessionReadGeneration) return;
      await activateAccount(auth.session, auth.identityStatus);
      if (auth.session && navigator.onLine) await connectRemote();
    },
    claimLegacyData: async () => {
      await initialize();
      const intendedAccount = requestedAccount,
        intendedGeneration = generation;
      return runMutation(async () => {
        if (!isCurrent(intendedAccount, intendedGeneration)) return;
        if (!requestedAccount || snapshot.identityStatus !== 'verified')
          throw new Error('Sign in before claiming legacy data.');
        const legacy = await db.records.get('app-data');
        if (!legacy) return;
        const data = validateBackup(legacy.data),
          accountId = requestedAccount,
          turn = generation;
        if (!isCurrent(accountId, turn)) return;
        const currentAccountData = await db.records.get(recordKey(accountId));
        if (
          currentAccountData &&
          JSON.stringify(validateBackup(currentAccountData.data)) !== JSON.stringify(emptyData())
        )
          throw new Error(
            'This account already has training data. Export it before choosing how to combine it with the legacy backup.',
          );
        await db.transaction('rw', db.records, db.outbox, db.meta, async () => {
          await db.records.put({ key: recordKey(accountId), data });
          const rev = Number((await db.meta.get(metaKey(accountId, 'revision')))?.value ?? 0);
          const item: OutboxItem = {
            operationId: id('op'),
            deviceId: getDevice(),
            baseRevision: rev,
            data,
            createdAt: new Date().toISOString(),
            accountId,
          };
          await db.outbox.put(item);
          await db.meta.put({ key: metaKey(accountId, 'reservedNext'), value: rev + 1 });
        });
        publishIfCurrent(accountId, turn, {
          data,
          pendingCount: await db.outbox.where('accountId').equals(accountId).count(),
          syncStatus: 'local',
        });
        void connectRemote();
      });
    },
    signOut: async () => {
      await initialize();
      return runMutation(async () => {
        if (snapshot.pendingCount)
          throw new Error('Export or sync pending data before signing out.');
        try {
          localStorage.removeItem('training-verified-account');
        } catch {
          /* optional cache */
        }
        generation++;
        requestedAccount = null;
        syncPromise = undefined;
        serverAvailable = false;
        publish({
          session: null,
          identityStatus: 'local',
          data: emptyData(),
          conflict: null,
          syncStatus: 'local',
          pendingCount: 0,
          lastSyncedAt: null,
        });
      });
    },
    retrySync: async () => {
      await initialize();
      await connectRemote();
    },
    resolveConflict: async (choice: 'local' | 'remote') =>
      runMutation(async () => {
        const conflict = snapshot.conflict,
          accountId = requestedAccount,
          turn = generation;
        if (!conflict || !accountId) return;
        const chosen = choice === 'remote' ? conflict.data : snapshot.data;
        if (!chosen) return;
        await syncPromise;
        const hadRestore =
          choice === 'local' &&
          (await db.outbox.where('accountId').equals(accountId).toArray()).some(
            (outbox) => outbox.restore,
          );
        let item: OutboxItem | undefined;
        const resolvedAt = choice === 'remote' ? new Date().toISOString() : null;
        await db.transaction('rw', db.records, db.meta, db.outbox, async () => {
          await db.records.put({ key: recordKey(accountId), data: chosen });
          await db.meta.put({ key: metaKey(accountId, 'revision'), value: conflict.revision });
          await db.meta.put({ key: metaKey(accountId, 'reservedNext'), value: conflict.revision });
          await db.outbox.where('accountId').equals(accountId).delete();
          await db.meta.put({ key: metaKey(accountId, 'pendingCount'), value: 0 });
          if (resolvedAt)
            await db.meta.put({ key: metaKey(accountId, 'lastSyncedAt'), value: resolvedAt });
          if (choice === 'local') {
            item = {
              operationId: id('op'),
              deviceId: getDevice(),
              baseRevision: conflict.revision,
              data: chosen,
              createdAt: new Date().toISOString(),
              accountId,
              ...(hadRestore ? { restore: true } : {}),
            };
            await db.meta.put({
              key: metaKey(accountId, 'reservedNext'),
              value: conflict.revision + 1,
            });
            await db.outbox.put(item);
            await db.meta.put({ key: metaKey(accountId, 'pendingCount'), value: 1 });
          }
        });
        publishIfCurrent(accountId, turn, {
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
    exportLegacyData: async () => {
      const legacy = await db.records.get('app-data');
      return JSON.stringify(legacy ? validateBackup(legacy.data) : emptyData(), null, 2);
    },
    importData: async (input: unknown) => {
      const imported = validateBackup(typeof input === 'string' ? JSON.parse(input) : input);
      await update(() => imported, true);
    },
    deleteAllData: async () =>
      runMutation(async () => {
        await initialize();
        const accountId = requestedAccount,
          turn = generation;
        if (!accountId || snapshot.identityStatus !== 'verified')
          throw new Error('Sign in to delete cloud data.');
        if (!navigator.onLine)
          throw new Error('Connect to the internet before deleting cloud data.');
        await syncPromise;
        const auth = await readSession();
        if (auth.sequence !== sessionReadGeneration)
          throw new Error('Account changed before deletion.');
        if (auth.session?.accountId !== accountId || !isCurrent(accountId, turn))
          throw new Error('Account changed before deletion.');
        const response = await fetch('/api/state', {
          method: 'DELETE',
          headers: { 'X-Lifts-Account': accountId },
        });
        if (!isCurrent(accountId, turn))
          throw new Error('Account changed before deletion completed.');
        if (!response.ok) throw new Error(`Data deletion failed (${response.status}).`);
        const cleared = emptyData(),
          deletedAt = new Date().toISOString();
        await db.transaction('rw', db.records, db.meta, db.outbox, async () => {
          await db.records.delete(recordKey(accountId));
          await db.outbox.where('accountId').equals(accountId).delete();
          await db.meta.bulkDelete(
            (await db.meta.toCollection().primaryKeys()).filter((key) =>
              String(key).startsWith(keyPrefix(accountId)),
            ),
          );
          await db.records.put({ key: recordKey(accountId), data: cleared });
          await db.meta.bulkPut([
            { key: metaKey(accountId, 'revision'), value: 0 },
            { key: metaKey(accountId, 'reservedNext'), value: 0 },
            { key: metaKey(accountId, 'pendingCount'), value: 0 },
            { key: metaKey(accountId, 'lastSyncedAt'), value: deletedAt },
          ]);
        });
        serverAvailable = true;
        publishIfCurrent(accountId, turn, {
          data: cleared,
          syncStatus: 'synced',
          conflict: null,
          pendingCount: 0,
          lastSyncedAt: deletedAt,
        });
      }),
  };
}
