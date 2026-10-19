import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { AppData, SyncRequest } from '../shared/types';
import { emptyData, createRoutine } from '../shared/domain';

// Exercise the real store persistence/queue code without needing a rendered React tree.
vi.mock('react', () => ({
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
}));

let connection: { onLine: boolean };
let events: EventTarget;
let remote: { data: AppData; revision: number };
let currentAccount: string;
let requests: SyncRequest[];
let receipts: Map<string, number>;
let localStorageValues: Map<string, string>;
let stateReadAccounts: string[];
let useStore: (typeof import('../src/lib/store'))['useAppStore'];

beforeEach(async () => {
  vi.resetModules();
  connection = { onLine: false };
  events = new EventTarget();
  remote = { data: emptyData(), revision: 0 };
  currentAccount = 'account-a';
  requests = [];
  receipts = new Map();
  localStorageValues = new Map();
  stateReadAccounts = [];
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('navigator', connection);
  vi.stubGlobal('window', events);
  // Dexie is an external module and retains its dependency object across module resets.
  const Dexie = (await import('dexie')).default;
  Dexie.dependencies.indexedDB = globalThis.indexedDB;
  Dexie.dependencies.IDBKeyRange = globalThis.IDBKeyRange;
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => localStorageValues.get(key) ?? null,
    setItem: (key: string, value: string) => localStorageValues.set(key, value),
    removeItem: (key: string) => localStorageValues.delete(key),
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/session')
        return Response.json({
          accountId: currentAccount,
          email: `${currentAccount}@example.test`,
          coachEnabled: true,
          profile: {
            publicId: `${currentAccount}-public`,
            displayName: 'Test',
            trainingTimezone: 'UTC',
          },
          sharing: {
            summaryEnabled: false,
            autoPublishWorkouts: false,
            policyRevision: 1,
            audienceAcknowledgedAt: null,
            enabledAt: null,
          },
        });
      if (!init?.method) {
        stateReadAccounts.push(new Headers(init?.headers).get('X-Lifts-Account') ?? '');
        return Response.json(remote);
      }
      const body = JSON.parse(String(init.body)) as SyncRequest;
      requests.push(body);
      const receipt = receipts.get(body.operationId);
      if (receipt !== undefined) return Response.json({ revision: receipt });
      if (body.baseRevision !== remote.revision) return Response.json(remote, { status: 409 });
      remote = { data: body.data, revision: remote.revision + 1 };
      receipts.set(body.operationId, remote.revision);
      return Response.json({ revision: remote.revision });
    }),
  );
  useStore = (await import('../src/lib/store')).useAppStore;
});
afterEach(() => vi.unstubAllGlobals());

function reconnect() {
  connection.onLine = true;
  events.dispatchEvent(new Event('online'));
}
async function waitForSync() {
  await vi.waitFor(() => expect(useStore().syncStatus).toBe('synced'));
}

describe('durable local store synchronization', () => {
  it('saves locally while initial network discovery is stalled', async () => {
    connection.onLine = true;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const originalFetch = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/api/state' && !init?.method) await held;
        return originalFetch(url, init);
      }),
    );
    await useStore().update((data) => ({
      ...data,
      routines: [createRoutine('Saved before network')],
    }));
    expect(useStore().data?.routines[0].name).toBe('Saved before network');
    expect(JSON.parse(await useStore().exportData()).routines[0].name).toBe('Saved before network');
    release();
    await waitForSync();
    expect(remote.data.routines[0].name).toBe('Saved before network');
  });

  it('does not overwrite a mutation with a late reconnect pull', async () => {
    await useStore().exportData();
    remote = { data: { ...emptyData(), routines: [createRoutine('Other device')] }, revision: 1 };
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const originalFetch = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/api/state' && !init?.method) await held;
        return originalFetch(url, init);
      }),
    );
    reconnect();
    await useStore().update((data) => ({
      ...data,
      routines: [createRoutine('Locally logged while pulling')],
    }));
    release();
    await vi.waitFor(() => expect(useStore().syncStatus).toBe('conflict'));
    expect(useStore().data?.routines[0].name).toBe('Locally logged while pulling');
    expect(useStore().conflict?.data.routines[0].name).toBe('Other device');
  });

  it('recovers local data and pending operations after an application reload', async () => {
    await useStore().update((data) => ({
      ...data,
      routines: [createRoutine('Recovered after reload')],
    }));
    vi.resetModules();
    events = new EventTarget();
    vi.stubGlobal('window', events);
    useStore = (await import('../src/lib/store')).useAppStore;
    const recovered = JSON.parse(await useStore().exportData());
    expect(recovered.routines[0].name).toBe('Recovered after reload');
    reconnect();
    await waitForSync();
    expect(remote.data.routines[0].name).toBe('Recovered after reload');
    expect(remote.revision).toBe(1);
  });

  it('persists multiple offline mutations and replays consecutive revisions', async () => {
    const routine = createRoutine('Offline routine');
    await useStore().update((data) => ({ ...data, routines: [routine] }));
    await useStore().update((data) => ({
      ...data,
      settings: { ...data.settings, profile: { ...data.settings.profile, goals: 'Get stronger' } },
    }));
    expect(useStore().data?.routines[0].name).toBe('Offline routine');
    expect(JSON.parse(await useStore().exportData()).settings.profile.goals).toBe('Get stronger');
    expect(requests).toHaveLength(0);
    reconnect();
    await waitForSync();
    expect(requests.map((item) => item.baseRevision)).toEqual([0, 1]);
    expect(remote.data.settings.profile.goals).toBe('Get stronger');
  });

  it('keeps each verified account in its own local partition when the shared device changes accounts', async () => {
    await useStore().update((data) => ({ ...data, routines: [createRoutine('Account A')] }));
    currentAccount = 'account-b';
    await useStore().refreshSession();
    expect(useStore().data?.routines).toEqual([]);
    await useStore().update((data) => ({ ...data, routines: [createRoutine('Account B')] }));
    currentAccount = 'account-a';
    await useStore().refreshSession();
    expect(useStore().data?.routines[0].name).toBe('Account A');
  });

  it('discards a delayed account A pull after the same tab switches to account B', async () => {
    await useStore().refreshSession();
    currentAccount = 'account-b';
    await useStore().refreshSession();
    await useStore().update((data) => ({ ...data, routines: [createRoutine('B local data')] }));
    currentAccount = 'account-a';
    await useStore().refreshSession();
    connection.onLine = true;
    let release!: () => void;
    let reachedPull!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reached = new Promise<void>((resolve) => {
      reachedPull = resolve;
    });
    const originalFetch = globalThis.fetch;
    let firstPull = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/api/state' && !init?.method && firstPull) {
          firstPull = false;
          reachedPull();
          await held;
        }
        return originalFetch(url, init);
      }),
    );
    const pendingPull = useStore().retrySync();
    await reached;
    currentAccount = 'account-b';
    connection.onLine = false;
    await useStore().refreshSession();
    release();
    await pendingPull;
    expect(useStore().session?.accountId).toBe('account-b');
    expect(useStore().data?.routines[0].name).toBe('B local data');
    expect(requests).toHaveLength(0);
  });

  it('ignores a stale account A session response after account B verifies', async () => {
    let releaseA!: () => void;
    const heldA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    const originalFetch = globalThis.fetch;
    let holdFirstSession = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/api/session' && holdFirstSession) {
          holdFirstSession = false;
          const account = currentAccount;
          if (account === 'account-a') {
            await heldA;
            return Response.json({
              accountId: account,
              email: `${account}@example.test`,
              coachEnabled: true,
              profile: {
                publicId: `${account}-public`,
                displayName: 'Test',
                trainingTimezone: 'UTC',
              },
              sharing: {
                summaryEnabled: false,
                autoPublishWorkouts: false,
                policyRevision: 1,
                audienceAcknowledgedAt: null,
                enabledAt: null,
              },
            });
          }
        }
        return originalFetch(url, init);
      }),
    );
    const staleA = useStore().refreshSession();
    currentAccount = 'account-b';
    await useStore().refreshSession();
    releaseA();
    await staleA;
    expect(useStore().session?.accountId).toBe('account-b');
    expect(localStorageValues.get('training-verified-account')).toBe('account-b');
  });

  it('clears cached verified identity after an explicit 401', async () => {
    await useStore().refreshSession();
    expect(localStorageValues.get('training-verified-account')).toBe('account-a');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url === '/api/session' ? new Response(null, { status: 401 }) : Response.json(remote),
      ),
    );
    await useStore().refreshSession();
    expect(localStorageValues.has('training-verified-account')).toBe(false);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network unavailable');
      }),
    );
    await useStore().refreshSession();
    expect(useStore().identityStatus).toBe('local');
    expect(useStore().session).toBeNull();
  });

  it('invalidates a delayed pull when signing out', async () => {
    await useStore().refreshSession();
    connection.onLine = true;
    let release!: () => void;
    let reachedPull!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reached = new Promise<void>((resolve) => {
      reachedPull = resolve;
    });
    const originalFetch = globalThis.fetch;
    let hold = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/api/state' && !init?.method && hold) {
          hold = false;
          reachedPull();
          await held;
        }
        return originalFetch(url, init);
      }),
    );
    const pendingPull = useStore().retrySync();
    await reached;
    await useStore().signOut();
    release();
    await pendingPull;
    expect(useStore().session).toBeNull();
    expect(useStore().identityStatus).toBe('local');
    expect(localStorageValues.has('training-verified-account')).toBe(false);
  });

  it('marks imported backup writes as restores so publication intent cannot be replayed', async () => {
    const data = { ...emptyData(), routines: [createRoutine('Restored backup')] };
    await useStore().importData(data);
    expect(useStore().pendingCount).toBe(1);
    reconnect();
    await waitForSync();
    expect(requests[0]).toMatchObject({ accountId: 'account-a', restore: true });
  });

  it('retains the restore marker when resolving an import conflict with local data', async () => {
    const imported = { ...emptyData(), routines: [createRoutine('Imported backup')] };
    await useStore().importData(imported);
    remote = { data: { ...emptyData(), routines: [createRoutine('Remote update')] }, revision: 1 };
    reconnect();
    await vi.waitFor(() => expect(useStore().syncStatus).toBe('conflict'));
    await useStore().resolveConflict('local');
    await waitForSync();
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({ accountId: 'account-a', restore: true });
    expect(remote.data.routines[0].name).toBe('Imported backup');
  });

  it('does not upload pending local data after session identity changes', async () => {
    await useStore().update((data) => ({ ...data, routines: [createRoutine('Private to A')] }));
    currentAccount = 'account-b';
    connection.onLine = true;
    await useStore().refreshSession();
    expect(requests).toHaveLength(0);
    expect(useStore().data?.routines).toEqual([]);
  });

  it('keeps legacy data unowned until claimed and preserves its backup after claim', async () => {
    const legacyData = { ...emptyData(), routines: [createRoutine('Old local data')] };
    const Dexie = (await import('dexie')).default;
    const legacyDb = new Dexie('training-lab');
    legacyDb.version(4).stores({
      records: 'key',
      meta: 'key',
      outbox: 'operationId,baseRevision,accountId',
    });
    await legacyDb.table('records').put({ key: 'app-data', data: legacyData });
    await legacyDb.close();
    await useStore().refreshSession();
    expect(useStore().legacyAvailable).toBe(true);
    expect(JSON.parse(await useStore().exportLegacyData()).routines[0].name).toBe('Old local data');
    expect(requests).toHaveLength(0);
    await useStore().claimLegacyData();
    expect(useStore().data?.routines[0].name).toBe('Old local data');
    expect(useStore().legacyAvailable).toBe(true);
    expect(JSON.parse(await useStore().exportLegacyData()).routines[0].name).toBe('Old local data');
  });

  it('publishes a durable pending count and last successful sync time', async () => {
    await useStore().update((data) => ({ ...data, routines: [createRoutine('Pending locally')] }));
    expect(useStore().pendingCount).toBe(1);
    expect(useStore().lastSyncedAt).toBeNull();
    reconnect();
    await waitForSync();
    expect(stateReadAccounts).toContain('account-a');
    expect(useStore().pendingCount).toBe(0);
    expect(useStore().lastSyncedAt).toEqual(expect.any(String));

    vi.resetModules();
    events = new EventTarget();
    vi.stubGlobal('window', events);
    useStore = (await import('../src/lib/store')).useAppStore;
    await useStore().exportData();
    expect(useStore().pendingCount).toBe(0);
    expect(useStore().lastSyncedAt).toEqual(expect.any(String));
  });

  it('deletes cloud and local data only after the server confirms deletion', async () => {
    await useStore().update((data) => ({
      ...data,
      routines: [createRoutine('Delete me')],
    }));
    reconnect();
    await waitForSync();
    const originalFetch = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'DELETE') {
          remote = { data: emptyData(), revision: 0 };
          return new Response(null, { status: 204 });
        }
        return originalFetch(url, init);
      }),
    );
    await useStore().deleteAllData();
    const deleteCall = vi
      .mocked(globalThis.fetch)
      .mock.calls.find((call) => call[1]?.method === 'DELETE');
    expect(new Headers(deleteCall?.[1]?.headers).get('X-Lifts-Account')).toBe('account-a');
    expect(useStore().data).toEqual(emptyData());
    expect(useStore().pendingCount).toBe(0);
    expect(useStore().syncStatus).toBe('synced');
    expect(JSON.parse(await useStore().exportData())).toEqual(emptyData());
  });

  it('keeps local data when cloud deletion fails', async () => {
    connection.onLine = true;
    await useStore().update((data) => ({
      ...data,
      routines: [createRoutine('Keep me')],
    }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) =>
        url === '/api/session'
          ? Response.json({
              accountId: currentAccount,
              email: `${currentAccount}@example.test`,
              coachEnabled: true,
              profile: {
                publicId: `${currentAccount}-public`,
                displayName: 'Test',
                trainingTimezone: 'UTC',
              },
              sharing: {
                summaryEnabled: false,
                autoPublishWorkouts: false,
                policyRevision: 1,
                audienceAcknowledgedAt: null,
                enabledAt: null,
              },
            })
          : Response.json({}, { status: 503 }),
      ),
    );
    await expect(useStore().deleteAllData()).rejects.toThrow('Data deletion failed');
    expect(useStore().data?.routines[0].name).toBe('Keep me');
  });

  it('serializes concurrent local mutations without losing either update', async () => {
    await Promise.all([
      useStore().update((data) => ({
        ...data,
        settings: { ...data.settings, profile: { ...data.settings.profile, goals: 'Strength' } },
      })),
      useStore().update((data) => ({
        ...data,
        settings: {
          ...data.settings,
          profile: { ...data.settings.profile, equipment: 'Dumbbells' },
        },
      })),
    ]);
    expect(useStore().data?.settings.profile).toMatchObject({
      goals: 'Strength',
      equipment: 'Dumbbells',
    });
    reconnect();
    await waitForSync();
    expect(remote.data.settings.profile).toMatchObject({
      goals: 'Strength',
      equipment: 'Dumbbells',
    });
    expect(remote.revision).toBe(2);
  });

  it('retries the same operation after the server saved it but its acknowledgement was lost', async () => {
    await useStore().update((data) => ({ ...data, routines: [createRoutine('Retry me')] }));
    const originalFetch = globalThis.fetch;
    let loseAcknowledgement = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const result = await originalFetch(url, init);
        if (init?.method === 'PUT' && loseAcknowledgement) {
          loseAcknowledgement = false;
          throw new Error('Connection dropped after commit');
        }
        return result;
      }),
    );
    reconnect();
    await vi.waitFor(() => expect(useStore().syncStatus).toBe('error'));
    expect(remote.revision).toBe(1);
    await useStore().retrySync();
    await waitForSync();
    expect(requests).toHaveLength(2);
    expect(requests[0].operationId).toBe(requests[1].operationId);
    expect(remote.revision).toBe(1);
    expect(remote.data.routines).toHaveLength(1);
  });

  it('preserves local pending work on a cross-device conflict until explicit resolution', async () => {
    await useStore().update((data) => ({ ...data, routines: [createRoutine('This device')] }));
    remote = { data: { ...emptyData(), routines: [createRoutine('Other device')] }, revision: 1 };
    reconnect();
    await vi.waitFor(() => expect(useStore().syncStatus).toBe('conflict'));
    expect(useStore().data?.routines[0].name).toBe('This device');
    expect(useStore().conflict?.data.routines[0].name).toBe('Other device');
    await useStore().resolveConflict('local');
    await waitForSync();
    expect(remote.data.routines[0].name).toBe('This device');
    expect(remote.revision).toBe(2);
  });

  it('drains a new update queued while an earlier network write is in flight', async () => {
    await useStore().update((data) => ({ ...data, routines: [createRoutine('First')] }));
    const originalFetch = globalThis.fetch;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let first = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'PUT' && first) {
          first = false;
          await held;
        }
        return originalFetch(url, init);
      }),
    );
    reconnect();
    await vi.waitFor(() => expect(useStore().syncStatus).toBe('syncing'));
    await useStore().update((data) => ({
      ...data,
      settings: {
        ...data.settings,
        profile: { ...data.settings.profile, notes: 'Queued during send' },
      },
    }));
    release();
    await waitForSync();
    expect(requests.map((item) => item.baseRevision)).toEqual([0, 1]);
    expect(remote.data.settings.profile.notes).toBe('Queued during send');
  });
});
