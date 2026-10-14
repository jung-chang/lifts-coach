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
let requests: SyncRequest[];
let receipts: Map<string, number>;
let useStore: (typeof import('../src/lib/store'))['useAppStore'];

beforeEach(async () => {
  vi.resetModules();
  connection = { onLine: false };
  events = new EventTarget();
  remote = { data: emptyData(), revision: 0 };
  requests = [];
  receipts = new Map();
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('navigator', connection);
  vi.stubGlobal('window', events);
  // Dexie is an external module and retains its dependency object across module resets.
  const Dexie = (await import('dexie')).default;
  Dexie.dependencies.indexedDB = globalThis.indexedDB;
  Dexie.dependencies.IDBKeyRange = globalThis.IDBKeyRange;
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init?.method) return Response.json(remote);
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
        if (!init?.method) await held;
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
        if (!init?.method) await held;
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
