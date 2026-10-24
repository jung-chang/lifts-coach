import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { sanitizeCoachValue } from '../worker/coach';
import worker from '../worker/index';
import {
  createPrescription,
  createRoutine,
  emptyData,
  finishWorkout,
  startWorkout,
  validateBackup,
} from '../shared/domain';
import { catalog } from '../shared/catalog';
import { migrateQueuedItem } from '../src/lib/store';
import { splitState } from '../worker/chunks';

class TestD1 {
  db = new DatabaseSync(':memory:');
  constructor() {
    for (const file of [
      '0001_initial.sql',
      '0002_state_chunks.sql',
      '0003_account_isolation.sql',
      '0004_accounts_community.sql',
      '0005_profile_setup.sql',
    ])
      this.db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  }
  prepare(sql: string) {
    let values: unknown[] = [];
    const statement = {
      _sql: sql,
      bind: (...args: unknown[]) => {
        values = args;
        return statement;
      },
      first: async <T = Record<string, unknown>>(column?: string): Promise<T | null> => {
        const row = this.db.prepare(sql).get(...(values as never[])) as
          | Record<string, unknown>
          | undefined;
        return row ? (column ? (row[column] as T) : (row as T)) : null;
      },
      all: async <T = Record<string, unknown>>() => ({
        results: this.db.prepare(sql).all(...(values as never[])) as T[],
      }),
      run: async () => {
        const result = this.db.prepare(sql).run(...(values as never[]));
        return { success: true, meta: { changes: Number(result.changes) } };
      },
    };
    return statement;
  }
  async batch(statements: ReturnType<TestD1['prepare']>[]) {
    this.db.exec('BEGIN');
    try {
      const out = [];
      for (const statement of statements) {
        if (/^\s*(SELECT|PRAGMA)\b/i.test(statement._sql)) out.push(await statement.all());
        else out.push({ results: [], meta: (await statement.run()).meta });
      }
      this.db.exec('COMMIT');
      return out;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

async function stateCall(db: TestD1, body: unknown) {
  return worker.fetch(
    new Request('http://localhost/api/state', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { DB: db as never, ASSETS: {} as never, LOCAL_DEV: 'true' } as never,
    {} as ExecutionContext,
  );
}
async function initializeState(db: TestD1) {
  return worker.fetch(
    new Request('http://localhost/api/state'),
    { DB: db as never, ASSETS: {} as never, LOCAL_DEV: 'true' } as never,
    {} as ExecutionContext,
  );
}

describe('exercise note compatibility', () => {
  it('strips persistent notes at every nested Coach context depth', () => {
    const safe = sanitizeCoachValue({
      routine: [
        { persistentNote: 'private', exercise: { persistentNote: 'also private', name: 'RDL' } },
      ],
      draft: { exercises: [{ persistentNote: 'private draft' }] },
      workout: {
        snapshot: { persistentNote: 'private snapshot' },
        notes: 'session field remains separately controlled',
      },
    });
    expect(JSON.stringify(safe)).not.toContain('private');
    expect(safe).toMatchObject({
      workout: { notes: 'session field remains separately controlled' },
    });
  });

  it('migrates v1 data with empty exercise notes and no invented values', () => {
    const old = { ...emptyData(), schemaVersion: 1 };
    const migrated = validateBackup(old);
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.exerciseSettings).toEqual({});
  });

  it('migrates queued v1 payloads while retaining their original receipt fingerprint input', () => {
    const legacy = { ...emptyData(), schemaVersion: 1 as const };
    const item = migrateQueuedItem({
      operationId: 'op-retry',
      deviceId: 'device-a',
      baseRevision: 12,
      accountId: 'account-a',
      createdAt: '2026-10-23T12:00:00.000Z',
      data: legacy,
    });
    expect(item.data.schemaVersion).toBe(2);
    expect(item.legacyData).toEqual(legacy);
    expect(item).toMatchObject({
      operationId: 'op-retry',
      baseRevision: 12,
      accountId: 'account-a',
    });
  });

  it('rejects stale v1 writes but replays receipts created from the original v1 payload', async () => {
    const db = new TestD1();
    const { exerciseSettings: _newField, ...v1 } = { ...emptyData(), schemaVersion: 1 as const };
    await initializeState(db);
    const account = db.db.prepare('SELECT id FROM accounts').get() as { id: string };
    db.db.prepare('UPDATE account_state SET revision=1 WHERE account_id=?').run(account.id);
    const oldDigest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify({ data: v1, deviceId: 'device-a', baseRevision: 0 })),
    );
    const fingerprint = [...new Uint8Array(oldDigest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    db.db
      .prepare(
        'INSERT INTO sync_receipts(account_id,operation_id,revision,created_at,fingerprint) VALUES(?,?,?,?,?)',
      )
      .run(account.id, 'op-old', 1, new Date().toISOString(), fingerprint);

    const migrated = validateBackup(v1);
    const replay = await stateCall(db, {
      operationId: 'op-old',
      deviceId: 'device-a',
      baseRevision: 0,
      data: migrated,
      legacyData: v1,
    });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ revision: 1 });

    const stale = await stateCall(db, {
      operationId: 'op-stale',
      deviceId: 'device-a',
      baseRevision: 1,
      data: v1,
    });
    expect(stale.status).toBe(426);
    expect(await stale.json()).toMatchObject({ code: 'client_upgrade_required' });
    expect(db.db.prepare('SELECT revision FROM account_state').get()).toMatchObject({
      revision: 1,
    });
  });

  it('replays a chunked v1 receipt without changing state, then blocks stale v1 writes after v2 sync', async () => {
    const db = new TestD1();
    await initializeState(db);
    const account = db.db.prepare('SELECT id FROM accounts').get() as { id: string };
    const routine = {
      ...createRoutine('Synthetic legacy routine'),
      exercises: [createPrescription(catalog[0].id)],
    };
    const withRoutine = { ...emptyData(), routines: [routine] };
    const started = startWorkout(withRoutine, routine.id);
    const legacyCurrent = finishWorkout(
      started,
      started.workouts[0].id,
      undefined,
      'Synthetic legacy workout note',
    );
    const { exerciseSettings: _exerciseSettings, ...v1 } = {
      ...legacyCurrent,
      schemaVersion: 1 as const,
      settings: {
        ...legacyCurrent.settings,
        profile: { ...legacyCurrent.settings.profile, notes: 'x'.repeat(1_100_000) },
      },
    };
    const originalText = JSON.stringify(v1);
    const chunks = splitState(originalText);
    expect(chunks.length).toBeGreaterThan(1);
    db.db
      .prepare('UPDATE account_state SET payload=?,revision=1 WHERE account_id=?')
      .run('', account.id);
    const insertChunk = db.db.prepare(
      'INSERT INTO state_chunks(account_id,chunk_index,content) VALUES(?,?,?)',
    );
    chunks.forEach((content, index) => insertChunk.run(account.id, index, content));

    const oldDigest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify({ data: v1, deviceId: 'device-a', baseRevision: 0 })),
    );
    const fingerprint = [...new Uint8Array(oldDigest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    db.db
      .prepare(
        'INSERT INTO sync_receipts(account_id,operation_id,revision,created_at,fingerprint) VALUES(?,?,?,?,?)',
      )
      .run(account.id, 'op-chunked-old', 1, new Date().toISOString(), fingerprint);

    const migrated = validateBackup(v1);
    expect(migrated.routines[0].name).toBe('Synthetic legacy routine');
    expect(migrated.workouts[0].notes).toBe('Synthetic legacy workout note');
    const replay = await stateCall(db, {
      operationId: 'op-chunked-old',
      deviceId: 'device-a',
      baseRevision: 0,
      data: migrated,
      legacyData: v1,
    });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ revision: 1 });
    const stateAfterReplay = db.db
      .prepare('SELECT payload,revision FROM account_state WHERE account_id=?')
      .get(account.id) as { payload: string; revision: number };
    const chunksAfterReplay = db.db
      .prepare(
        'SELECT chunk_index,content FROM state_chunks WHERE account_id=? ORDER BY chunk_index',
      )
      .all(account.id);
    expect(stateAfterReplay).toEqual({ payload: '', revision: 1 });
    expect(chunksAfterReplay).toEqual(
      chunks.map((content, chunk_index) => ({ chunk_index, content })),
    );

    const upgraded = {
      ...migrated,
      exerciseSettings: {
        [catalog[0].id]: {
          persistentNote: 'Synthetic v2 note',
          updatedAt: new Date().toISOString(),
        },
      },
    };
    const upgrade = await stateCall(db, {
      operationId: 'op-v2-upgrade',
      deviceId: 'device-b',
      baseRevision: 1,
      data: upgraded,
    });
    expect(upgrade.status).toBe(200);
    const stale = await stateCall(db, {
      operationId: 'op-stale-after-v2',
      deviceId: 'device-a',
      baseRevision: 2,
      data: v1,
    });
    expect(stale.status).toBe(426);
    expect(await stale.json()).toMatchObject({ code: 'client_upgrade_required' });
    const stored = await worker.fetch(
      new Request('http://localhost/api/state'),
      { DB: db as never, ASSETS: {} as never, LOCAL_DEV: 'true' } as never,
      {} as ExecutionContext,
    );
    const storedBody = (await stored.json()) as { data: typeof upgraded; revision: number };
    expect(storedBody.revision).toBe(2);
    expect(storedBody.data.exerciseSettings[catalog[0].id].persistentNote).toBe(
      'Synthetic v2 note',
    );
    expect(storedBody.data.workouts[0].notes).toBe('Synthetic legacy workout note');
  });
});
