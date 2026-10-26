import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import worker from '../worker/index';
import { emptyData, createRoutine, createPrescription, applyProposal } from '../shared/domain';
import { catalog } from '../shared/catalog';

class TestD1 {
  db = new DatabaseSync(':memory:');
  writes: { sql: string; changes: number }[] = [];
  queries: string[] = [];
  beforeBatch?: (sql: string[]) => Promise<void>;
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
    this.queries.push(sql);
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
        const r = this.db.prepare(sql).run(...(values as never[]));
        this.writes.push({ sql, changes: Number(r.changes) });
        return { success: true, meta: { changes: Number(r.changes) } };
      },
    };
    return statement;
  }
  async batch(statements: ReturnType<TestD1['prepare']>[]) {
    await this.beforeBatch?.(statements.map((s) => s._sql));
    this.db.exec('BEGIN');
    try {
      const out = [];
      for (const s of statements) {
        if (/^\s*(SELECT|PRAGMA)\b/i.test((s as any)._sql)) out.push(await s.all());
        else {
          const result = await s.run();
          out.push({ results: [], meta: result.meta });
        }
      }
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
}

const issuer = 'https://community-test.cloudflareaccess.com',
  aud = 'community-app';
let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let jwks: { keys: object[] };
beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  jwks = {
    keys: [
      { ...(await exportJWK(pair.publicKey)), kid: 'community-test', alg: 'RS256', use: 'sig' },
    ],
  };
});
afterEach(() => vi.unstubAllGlobals());
async function auth(email: string, sub: string) {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: 'RS256', kid: 'community-test' })
    .setIssuer(issuer)
    .setAudience(aud)
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
}
async function call(
  db: TestD1,
  token: string,
  path: string,
  method = 'GET',
  body?: unknown,
  providerEnv: Record<string, string> = {},
) {
  return worker.fetch(
    new Request(`https://app.example.test${path}`, {
      method,
      headers: {
        'Cf-Access-Jwt-Assertion': token,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    }),
    {
      DB: db as never,
      ASSETS: {} as never,
      ACCESS_TEAM_DOMAIN: issuer,
      ACCESS_AUD: aud,
      ...providerEnv,
    } as never,
    {} as ExecutionContext,
  );
}
function finishedData() {
  const data = emptyData(),
    completedAt = new Date().toISOString(),
    startedAt = completedAt;
  data.exerciseSettings = {
    'ex_barbell-bench-press': {
      persistentNote: 'synthetic persistent setting private',
      updatedAt: completedAt,
    },
  };
  data.workouts = [
    {
      id: 'workout-1',
      name: 'Upper session',
      startedAt,
      completedAt,
      status: 'finished',
      updatedAt: completedAt,
      notes: 'private note',
      feeling: 'tired',
      exercises: [
        {
          id: 'instance-1',
          exerciseId: 'ex_barbell-bench-press',
          name: 'Bench press',
          notes: 'synthetic private exercise note',
          persistentNote: 'synthetic persistent instruction private',
          feeling: 'hard',
          repsInReserve: '0',
          sets: 3,
          repRange: [8, 10],
          targetWeight: 100,
          restSeconds: 60,
          loadMode: 'external',
          actualSets: [
            {
              id: 'set-1',
              weight: 100,
              reps: 8,
              kind: 'working',
              status: 'completed',
              completedAt,
              updatedAt: completedAt,
              loadMode: 'external',
            },
          ],
        },
      ],
    },
  ];
  return data;
}

describe('community backend authorization and publication', () => {
  it('shows shared custom exercise snapshot names without adding them to the viewer library', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(jwks)),
    );
    const db = new TestD1();
    const owner = await auth('owner@example.test', 'owner-sub');
    const member = await auth('member@example.test', 'member-sub');
    const session = (await (await call(db, owner, '/api/session')).json()) as any;
    const viewerBefore = await (await call(db, member, '/api/state')).json();
    const consent = await call(db, owner, '/api/me/sharing', 'PATCH', {
      summaryEnabled: false,
      autoPublishWorkouts: true,
      policyRevision: session.sharing.policyRevision,
      audienceAcknowledged: true,
    });
    expect(consent.status).toBe(200);
    const data = finishedData();
    const exercise = data.workouts[0].exercises[0];
    exercise.exerciseId = 'custom-synthetic-row';
    exercise.name = 'Single-arm cable row';
    // Historical snapshots must work even without a current library definition.
    expect(data.exercises).toEqual([]);
    const second = structuredClone(exercise);
    second.id = 'instance-2';
    second.name = 'Cable row with pause';
    second.actualSets[0].id = 'set-2';
    data.workouts[0].exercises.push(second);
    expect(
      (
        await call(db, owner, '/api/state', 'PUT', {
          accountId: session.accountId,
          operationId: 'sync-custom-names',
          deviceId: 'synthetic-device',
          baseRevision: 0,
          data,
        })
      ).status,
    ).toBe(200);
    const names = ['Single-arm cable row', 'Cable row with pause'];
    for (const path of [
      '/api/community/feed',
      `/api/community/profiles/${session.profile.publicId}/workouts`,
    ]) {
      const response = await call(db, member, path);
      expect(response.status).toBe(200);
      const page = (await response.json()) as any;
      expect(page.items[0].exerciseNames).toEqual(names);
      const detail = await call(db, member, `/api/community/workouts/${page.items[0].id}`);
      expect(detail.status).toBe(200);
      const body = (await detail.json()) as any;
      expect(body.exercises.map((entry: any) => entry.name)).toEqual(names);
      expect(JSON.stringify(body)).not.toContain('synthetic private exercise note');
      expect(body.exercises[0]).not.toHaveProperty('notes');
      expect(body.exercises[0]).not.toHaveProperty('repsInReserve');
    }
    expect(await (await call(db, member, '/api/state')).json()).toEqual(viewerBefore);
  });

  it('lets any admitted member generate a routine through the provider and save only after approval', async () => {
    const routine = {
      ...createRoutine('Synthetic AI routine'),
      exercises: [createPrescription(catalog[0].id)],
    };
    let providerRequests = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, init) => {
        if (String(url).includes('/cdn-cgi/access/certs')) return Response.json(jwks);
        providerRequests++;
        const payload = JSON.parse(init.body);
        expect(payload.model).toBe('gpt-5-mini');
        return Response.json({
          id: 'resp_synthetic_member',
          created_at: 1,
          model: payload.model,
          status: 'completed',
          output: [
            {
              id: 'msg_synthetic_member',
              type: 'message',
              role: 'assistant',
              status: 'completed',
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    text: 'Review this routine before saving.',
                    evidenceIds: [],
                    proposals: [
                      {
                        scope: 'routine',
                        targetId: routine.id,
                        edits: [],
                        rationale: 'Requested routine',
                        evidenceIds: [],
                        routineDraft: routine,
                        preference: null,
                        customExercise: null,
                      },
                    ],
                  }),
                  annotations: [],
                },
              ],
            },
          ],
          usage: { input_tokens: 20, output_tokens: 30, total_tokens: 50 },
        });
      }),
    );
    const db = new TestD1();
    try {
      const member = await auth('ordinary-member@example.test', 'ordinary-ai-member');
      const providerEnv = { OPENAI_API_KEY: 'synthetic-test-key' };
      const session = (await (await call(db, member, '/api/session')).json()) as any;
      expect(session.coachEnabled).toBe(true);
      const available = await call(db, member, '/api/providers', 'GET', undefined, providerEnv);
      expect((await available.json()) as any).toEqual([
        { id: 'openai', models: ['gpt-5-mini', 'gpt-4.1-mini'] },
      ]);
      const response = await call(
        db,
        member,
        '/api/coach/chat',
        'POST',
        { message: 'Create a bench press routine', provider: 'openai', model: '' },
        providerEnv,
      );
      expect(response.status).toBe(200);
      const result = (await response.json()) as any;
      expect(providerRequests).toBe(1);
      expect(result.proposals[0].routineDraft.name).toBe(routine.name);
      const state = ((await (await call(db, member, '/api/state')).json()) as any).data;
      expect(state.routines).toEqual([]);
      const approved = applyProposal(
        { ...state, proposals: result.proposals },
        result.proposals[0].id,
        [0],
      );
      expect(approved.routines[0]).toMatchObject({
        id: result.proposals[0].routineDraft.id,
        name: routine.name,
        exercises: routine.exercises.map(({ id: _id, ...exercise }) => exercise),
      });
      expect(approved.routines[0].id).not.toBe(routine.id);
      const saved = await call(db, member, '/api/state', 'PUT', {
        accountId: session.accountId,
        operationId: 'save-ai-routine',
        deviceId: 'synthetic-device',
        baseRevision: 0,
        data: approved,
      });
      expect(saved.status).toBe(200);
      expect(
        ((await (await call(db, member, '/api/state')).json()) as any).data.routines[0].name,
      ).toBe(routine.name);
    } finally {
      db.db.close();
    }
  });

  it('defaults new profile setup to future workout sharing without changing another account', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(jwks)),
    );
    const db = new TestD1();
    try {
      const first = await auth('first@example.test', 'setup-first');
      const second = await auth('second@example.test', 'setup-second');
      const before = (await (await call(db, first, '/api/session')).json()) as any;
      expect(before.profileSetupRequired).toBe(true);
      const invalid = await call(db, first, '/api/me/profile', 'PATCH', {
        displayName: 'Friend',
        trainingTimezone: 'Invalid/Zone',
      });
      expect(invalid.status).toBe(400);
      expect(
        ((await (await call(db, first, '/api/session')).json()) as any).profileSetupRequired,
      ).toBe(true);
      const saved = (await (
        await call(db, first, '/api/me/profile', 'PATCH', {
          displayName: 'Friend',
          trainingTimezone: 'America/New_York',
        })
      ).json()) as any;
      expect(saved).toMatchObject({
        profileSetupRequired: false,
        profile: { displayName: 'Friend', trainingTimezone: 'America/New_York' },
        sharing: { summaryEnabled: false, autoPublishWorkouts: true, policyRevision: 2 },
      });
      expect(
        ((await (await call(db, first, '/api/session')).json()) as any).profileSetupRequired,
      ).toBe(false);
      const other = (await (await call(db, second, '/api/session')).json()) as any;
      expect(other.accountId).not.toBe(saved.accountId);
      expect(other.profileSetupRequired).toBe(true);
      expect(other.profile.displayName).not.toBe('Friend');
      expect(other.sharing.autoPublishWorkouts).toBe(false);
    } finally {
      db.db.close();
    }
  });
  it('shares future workouts after setup and preserves later choices on retries', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(jwks)),
    );
    const db = new TestD1();
    try {
      const token = await auth('setup-sharing@example.test', 'setup-sharing');
      const session = (await (await call(db, token, '/api/session')).json()) as any;
      const data = finishedData();
      data.workouts[0].startedAt = '2026-01-01T12:00:00.000Z';
      data.workouts[0].completedAt = '2026-01-01T13:00:00.000Z';
      expect(
        (
          await call(db, token, '/api/state', 'PUT', {
            accountId: session.accountId,
            operationId: 'setup-old',
            deviceId: 'synthetic',
            baseRevision: 0,
            data,
          })
        ).status,
      ).toBe(200);
      const profile = { displayName: 'Synthetic member', trainingTimezone: 'UTC' };
      const saved = (await (
        await call(db, token, '/api/me/profile', 'PATCH', profile)
      ).json()) as any;
      expect(saved.sharing).toMatchObject({
        autoPublishWorkouts: true,
        summaryEnabled: false,
        policyRevision: 2,
      });
      expect(saved.sharing.audienceAcknowledgedAt).toBeTruthy();
      expect(saved.sharing.enabledAt).toBeTruthy();
      const recent = structuredClone(finishedData().workouts[0]);
      recent.id = 'after-setup';
      recent.name = 'Snapshot workout name';
      recent.startedAt = saved.sharing.enabledAt ?? new Date().toISOString();
      recent.completedAt = new Date().toISOString();
      const warmupOnly = structuredClone(recent.exercises[0]);
      warmupOnly.id = 'warmup-only-instance';
      warmupOnly.exerciseId = 'ex_dumbbell-bench';
      warmupOnly.name = 'Dumbbell bench press';
      warmupOnly.actualSets = warmupOnly.actualSets.map((set) => ({
        ...set,
        id: 'warmup-only-set',
        kind: 'warmup',
      }));
      recent.exercises.push(warmupOnly);
      data.routines = [{ ...createRoutine('Original routine name'), id: 'routine-1' }];
      data.workouts.push(recent);
      // A later routine rename must not rewrite the historical workout snapshot.
      data.routines[0].name = 'Renamed routine';
      const newSync = await call(db, token, '/api/state', 'PUT', {
        accountId: session.accountId,
        operationId: 'setup-new',
        deviceId: 'synthetic',
        baseRevision: 1,
        data,
      });
      expect(newSync.status, JSON.stringify(await newSync.clone().json())).toBe(200);
      const page = (await (await call(db, token, '/api/community/feed')).json()) as any;
      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toMatchObject({
        title: 'Snapshot workout name',
        exerciseCount: 2,
        setCount: 1,
      });
      expect(page.items[0].durationMinutes).toEqual(expect.any(Number));
      expect(page.items[0].durationMinutes).toBeGreaterThanOrEqual(0);
      expect(Date.parse(page.items[0].activityAt)).toBe(Date.parse(recent.completedAt));
      const detail = (await (
        await call(db, token, `/api/community/workouts/${page.items[0].id}`)
      ).json()) as any;
      expect(detail.title).toBe('Snapshot workout name');
      db.db
        .prepare('UPDATE workout_publications SET shared_title=NULL WHERE id=?')
        .run(page.items[0].id);
      const legacyPage = (await (await call(db, token, '/api/community/feed')).json()) as any;
      expect(legacyPage.items[0]).toMatchObject({
        id: page.items[0].id,
        title: 'Snapshot workout name',
        activityAt: page.items[0].activityAt,
        exerciseCount: 2,
      });
      const legacyDetail = (await (
        await call(db, token, `/api/community/workouts/${legacyPage.items[0].id}`)
      ).json()) as any;
      expect(legacyDetail.title).toBe('Snapshot workout name');
      expect(
        db.db
          .prepare('SELECT visibility FROM workout_visibility WHERE account_id=? AND workout_id=?')
          .get(session.accountId, 'workout-1'),
      ).toEqual({ visibility: 'private' });
      const changed = (await (
        await call(db, token, '/api/me/sharing', 'PATCH', {
          summaryEnabled: false,
          autoPublishWorkouts: false,
          policyRevision: saved.sharing.policyRevision,
          audienceAcknowledged: true,
        })
      ).json()) as any;
      const retried = (await (
        await call(db, token, '/api/me/profile', 'PATCH', profile)
      ).json()) as any;
      expect(retried.sharing).toEqual(changed.sharing);
    } finally {
      db.db.close();
    }
  });
  it('preserves an explicit sharing choice made before profile setup', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(jwks)),
    );
    const db = new TestD1();
    try {
      const token = await auth('setup-private@example.test', 'setup-private');
      await call(db, token, '/api/me/sharing', 'PATCH', {
        summaryEnabled: false,
        autoPublishWorkouts: false,
        policyRevision: 1,
      });
      const saved = (await (
        await call(db, token, '/api/me/profile', 'PATCH', {
          displayName: 'Synthetic private member',
          trainingTimezone: 'UTC',
        })
      ).json()) as any;
      expect(saved.sharing).toMatchObject({
        autoPublishWorkouts: false,
        enabledAt: null,
        policyRevision: 2,
      });
    } finally {
      db.db.close();
    }
  });
  it('keeps a synced private choice ahead of auto-publish and does not auto-publish after it is turned off', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(jwks)),
    );
    const db = new TestD1();
    try {
      const token = await auth('auto-override@example.test', 'auto-override');
      const session = (await (await call(db, token, '/api/session')).json()) as any;
      const enabled = (await (
        await call(db, token, '/api/me/sharing', 'PATCH', {
          summaryEnabled: false,
          autoPublishWorkouts: true,
          policyRevision: session.sharing.policyRevision,
          audienceAcknowledged: true,
        })
      ).json()) as any;
      const data = finishedData();
      data.workouts[0].startedAt = enabled.sharing.enabledAt;
      data.workouts[0].completedAt = new Date().toISOString();
      data.workouts[0].communityVisibility = {
        visibility: 'private',
        policyRevision: enabled.sharing.policyRevision,
      };
      const sync = {
        accountId: session.accountId,
        operationId: 'private-override',
        deviceId: 'synthetic-device',
        baseRevision: 0,
        data,
      };
      expect((await call(db, token, '/api/state', 'PUT', sync)).status).toBe(200);
      expect((await call(db, token, '/api/state', 'PUT', sync)).status).toBe(200);
      expect(((await (await call(db, token, '/api/community/feed')).json()) as any).items).toEqual(
        [],
      );
      expect(
        db.db
          .prepare('SELECT visibility FROM workout_visibility WHERE workout_id=?')
          .get('workout-1'),
      ).toEqual({ visibility: 'private' });
      expect(db.db.prepare('SELECT COUNT(*) count FROM workout_publications').get()).toEqual({
        count: 0,
      });

      const disabled = (await (
        await call(db, token, '/api/me/sharing', 'PATCH', {
          summaryEnabled: false,
          autoPublishWorkouts: false,
          policyRevision: enabled.sharing.policyRevision,
          audienceAcknowledged: false,
        })
      ).json()) as any;
      const newer = structuredClone(data.workouts[0]);
      newer.id = 'after-auto-off';
      newer.name = 'Auto off workout';
      newer.startedAt = new Date().toISOString();
      newer.completedAt = new Date().toISOString();
      delete newer.communityVisibility;
      data.workouts.push(newer);
      expect(
        (
          await call(db, token, '/api/state', 'PUT', {
            accountId: session.accountId,
            operationId: 'auto-off-sync',
            deviceId: 'synthetic-device',
            baseRevision: 1,
            data,
          })
        ).status,
      ).toBe(200);
      expect(disabled.sharing.autoPublishWorkouts).toBe(false);
      expect(
        db.db
          .prepare('SELECT visibility FROM workout_visibility WHERE workout_id=?')
          .get('after-auto-off'),
      ).toEqual({ visibility: 'private' });
      expect(((await (await call(db, token, '/api/community/feed')).json()) as any).items).toEqual(
        [],
      );
    } finally {
      db.db.close();
    }
  });
  it('accepts a blank Coach model for server defaulting and distinguishes unavailable providers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(jwks)),
    );
    const db = new TestD1();
    try {
      const token = await auth('enabled@example.test', 'coach-model-default');
      const response = await call(db, token, '/api/coach/chat', 'POST', {
        message: 'Hello',
        provider: 'openai',
        model: '',
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'provider_selection' });
    } finally {
      db.db.close();
    }
  });
  it('shares profile trends only while enabled without publishing private workout history', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(jwks)),
    );
    const db = new TestD1(),
      owner = await auth('stats-owner@example.test', 'stats-owner'),
      member = await auth('stats-viewer@example.test', 'stats-viewer');
    const session = (await (await call(db, owner, '/api/session')).json()) as any;
    const data = finishedData(),
      other = structuredClone(data.workouts[0]);
    other.id = 'older-session';
    other.startedAt = '2026-10-01T12:00:00Z';
    other.completedAt = '2026-10-01T13:00:00Z';
    other.exercises[0].actualSets[0].weight = 80;
    other.exercises[0].actualSets[0].completedAt = other.completedAt;
    data.workouts.push(other);
    expect(
      (
        await call(db, owner, '/api/state', 'PUT', {
          accountId: session.accountId,
          operationId: 'profile-trends',
          deviceId: 'synthetic',
          baseRevision: 0,
          data,
        })
      ).status,
    ).toBe(200);
    const path = `/api/community/profiles/${session.profile.publicId}`;
    expect(((await (await call(db, member, path)).json()) as any).exerciseStats).toEqual([]);
    const granted = (await (
      await call(db, owner, '/api/me/sharing', 'PATCH', {
        summaryEnabled: true,
        autoPublishWorkouts: false,
        policyRevision: session.sharing.policyRevision,
        audienceAcknowledged: true,
      })
    ).json()) as any;
    const shared = (await (await call(db, member, path)).json()) as any;
    expect(shared.statsVisible).toBe(true);
    expect(shared.exerciseStats[0].points.map((p: any) => p.weight)).toEqual([80, 100]);
    expect(shared.exerciseStats[0].personalBest).toMatchObject({ weight: 100, reps: 8 });
    expect(shared.workouts).toEqual([]);
    expect(
      (
        await call(db, owner, '/api/me/sharing', 'PATCH', {
          summaryEnabled: false,
          autoPublishWorkouts: false,
          policyRevision: granted.sharing.policyRevision,
          audienceAcknowledged: false,
        })
      ).status,
    ).toBe(200);
    const hidden = (await (await call(db, member, path)).json()) as any;
    expect(hidden.statsVisible).toBe(false);
    expect(hidden.exerciseStats).toEqual([]);
    expect(hidden.records).toEqual([]);
    db.db.close();
  });

  it('paginates only a selected profile’s shared workout history and denies blocked reads', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(jwks)),
    );
    const db = new TestD1(),
      owner = await auth('history-owner@example.test', 'history-owner'),
      member = await auth('history-viewer@example.test', 'history-viewer');
    const session = (await (await call(db, owner, '/api/session')).json()) as any;
    const consent = (await (
      await call(db, owner, '/api/me/sharing', 'PATCH', {
        summaryEnabled: false,
        autoPublishWorkouts: true,
        policyRevision: session.sharing.policyRevision,
        audienceAcknowledged: true,
      })
    ).json()) as any;
    const data = finishedData(),
      template = data.workouts[0];
    data.workouts = Array.from({ length: 6 }, (_, i) => ({
      ...structuredClone(template),
      id: `history-${i}`,
      startedAt: consent.sharing.enabledAt,
      completedAt: new Date(Date.now() + i).toISOString(),
    }));
    expect(
      (
        await call(db, owner, '/api/state', 'PUT', {
          accountId: session.accountId,
          operationId: 'history-page',
          deviceId: 'synthetic',
          baseRevision: 0,
          data,
        })
      ).status,
    ).toBe(200);
    const path = `/api/community/profiles/${session.profile.publicId}`;
    const page = (await (await call(db, member, path)).json()) as any;
    expect(page.workouts).toHaveLength(5);
    expect(page.nextWorkoutCursor).toBeTruthy();
    const next = (await (
      await call(
        db,
        member,
        `${path}/workouts?cursor=${encodeURIComponent(page.nextWorkoutCursor)}`,
      )
    ).json()) as any;
    expect(next.items).toHaveLength(1);
    expect(next.nextCursor).toBeNull();
    expect(new Set([...page.workouts, ...next.items].map((w: any) => w.id)).size).toBe(6);
    await call(db, member, `${path}/block`, 'POST');
    expect((await call(db, member, `${path}/workouts`)).status).toBe(404);
    db.db.close();
  });

  it('derives shared record stars from each owner’s full history without exposing private baselines', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(jwks)),
    );
    const db = new TestD1();
    const owner = await auth('pr-owner@example.test', 'pr-owner');
    const viewer = await auth('pr-viewer@example.test', 'pr-viewer');
    const session = (await (await call(db, owner, '/api/session')).json()) as any;
    const viewerSession = (await (await call(db, viewer, '/api/session')).json()) as any;
    const data = finishedData();
    const template = data.workouts[0];
    data.workouts = [100, 110, 105, 120].map((weight, index) => {
      const workout = structuredClone(template);
      workout.id = `record-session-${index}`;
      workout.startedAt = `2026-10-0${index + 1}T12:00:00Z`;
      workout.completedAt = `2026-10-0${index + 1}T13:00:00Z`;
      workout.updatedAt = workout.completedAt;
      const set = workout.exercises[0].actualSets[0];
      set.id = `record-set-${index}`;
      set.weight = weight;
      set.reps = index === 3 ? 1 : 8;
      set.completedAt = workout.completedAt;
      return workout;
    });
    expect(
      (
        await call(db, owner, '/api/state', 'PUT', {
          accountId: session.accountId,
          operationId: 'records-initial',
          deviceId: 'synthetic',
          baseRevision: 0,
          data,
        })
      ).status,
    ).toBe(200);
    // The viewer has lifted more than the author; that must not suppress the author's PR.
    const viewerData = finishedData();
    viewerData.workouts[0].exercises[0].actualSets[0].weight = 500;
    expect(
      (
        await call(db, viewer, '/api/state', 'PUT', {
          accountId: viewerSession.accountId,
          operationId: 'viewer-record',
          deviceId: 'synthetic',
          baseRevision: 0,
          data: viewerData,
        })
      ).status,
    ).toBe(200);
    for (const index of [2, 3]) {
      expect(
        (
          await call(db, owner, `/api/me/workouts/record-session-${index}/visibility`, 'PUT', {
            visibility: 'community',
            decisionRevision: 0,
            policyRevision: session.sharing.policyRevision,
            audienceAcknowledged: true,
          })
        ).status,
      ).toBe(200);
    }
    const page = (await (await call(db, viewer, '/api/community/feed')).json()) as any;
    expect(page.items).toHaveLength(2);
    const shared = await Promise.all(
      page.items.map(async (item: any) => ({
        item,
        detail: (await (
          await call(db, viewer, `/api/community/workouts/${item.id}`)
        ).json()) as any,
      })),
    );
    const lower = shared.find(({ detail }) => detail.exercises[0].sets[0].weight === 105)!;
    const higher = shared.find(({ detail }) => detail.exercises[0].sets[0].weight === 120)!;
    expect(lower.item.hasRecord).toBe(false);
    expect(lower.detail.recordSetIds).toEqual([]);
    expect(higher.item.hasRecord).toBe(true);
    expect(higher.detail.recordSetIds).toEqual(['record-set-3']);
    expect(JSON.stringify(shared)).not.toContain('record-session-1');
    expect(JSON.stringify(shared)).not.toContain('private note');
    expect(JSON.stringify(shared)).not.toContain('"weight":110');
    const profilePath = `/api/community/profiles/${session.profile.publicId}`;
    expect(((await (await call(db, viewer, profilePath)).json()) as any).exerciseStats).toEqual([]);
    const own = (await (await call(db, owner, profilePath)).json()) as any;
    expect(own.exerciseStats[0].personalBest).toMatchObject({ weight: 120, reps: 1 });
    // Correcting a private earlier lift must remove the later public achievement.
    data.workouts[1].exercises[0].actualSets[0].weight = 130;
    expect(
      (
        await call(db, owner, '/api/state', 'PUT', {
          accountId: session.accountId,
          operationId: 'records-corrected',
          deviceId: 'synthetic',
          baseRevision: 1,
          data,
        })
      ).status,
    ).toBe(200);
    const corrected = (await (
      await call(db, viewer, `/api/community/workouts/${higher.item.id}`)
    ).json()) as any;
    expect(corrected.recordSetIds).toEqual([]);
    const correctedFeed = (await (await call(db, viewer, '/api/community/feed')).json()) as any;
    expect(correctedFeed.items.every((item: any) => !item.hasRecord)).toBe(true);
    db.db.close();
  });
  it('selects lower assistance as the qualified record at matching reps', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(jwks)),
    );
    const db = new TestD1(),
      token = await auth('records@example.test', 'records-subject');
    const session = (await (await call(db, token, '/api/session')).json()) as any;
    const data = finishedData(),
      exercise = data.workouts[0].exercises[0];
    exercise.loadMode = 'assistance';
    data.exerciseSettings = {};
    exercise.actualSets[0].loadMode = 'assistance';
    exercise.actualSets.push({ ...exercise.actualSets[0], id: 'lower-assistance', weight: 50 });
    expect(
      (
        await call(db, token, '/api/state', 'PUT', {
          accountId: session.accountId,
          operationId: 'record-sync',
          deviceId: 'synthetic-device',
          baseRevision: 0,
          data,
        })
      ).status,
    ).toBe(200);
    const detail = (await (
      await call(db, token, `/api/community/profiles/${session.profile.publicId}`)
    ).json()) as any;
    expect(detail.records).toHaveLength(1);
    expect(detail.records[0]).toMatchObject({ loadMode: 'assistance', weight: 50, reps: 8 });
    db.db.close();
  });

  it('keeps existing shares when auto-sharing stops and preserves a private override across stale snapshot sync', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(jwks)),
    );
    const db = new TestD1(),
      token = await auth('sharing@example.test', 'sharing-subject');
    const session = (await (await call(db, token, '/api/session')).json()) as any;
    expect(session.coachEnabled).toBe(true);
    expect(await (await call(db, token, '/api/providers')).json()).toEqual([]);
    expect(
      (await call(db, token, '/api/coach/chat', 'POST', { message: 'hello', provider: 'openai' }))
        .status,
    ).toBe(400);
    const enabled = (await (
      await call(db, token, '/api/me/sharing', 'PATCH', {
        summaryEnabled: false,
        autoPublishWorkouts: true,
        policyRevision: session.sharing.policyRevision,
        audienceAcknowledged: true,
      })
    ).json()) as any;
    const data = finishedData();
    data.workouts[0].startedAt = enabled.sharing.enabledAt;
    data.workouts[0].communityVisibility = {
      visibility: 'community',
      policyRevision: enabled.sharing.policyRevision,
    };
    const sync = {
      accountId: session.accountId,
      operationId: 'share-sync',
      deviceId: 'synthetic-device',
      baseRevision: 0,
      data,
    };
    expect((await call(db, token, '/api/state', 'PUT', sync)).status).toBe(200);
    expect(
      ((await (await call(db, token, '/api/community/feed')).json()) as any).items,
    ).toHaveLength(1);
    const stoppedResponse = await call(db, token, '/api/me/sharing', 'PATCH', {
      summaryEnabled: false,
      autoPublishWorkouts: false,
      policyRevision: enabled.sharing.policyRevision,
      audienceAcknowledged: false,
    });
    expect(stoppedResponse.status).toBe(200);
    const stopped = (await stoppedResponse.json()) as any;
    expect(
      ((await (await call(db, token, '/api/community/feed')).json()) as any).items,
    ).toHaveLength(1);
    expect(
      (
        await call(db, token, '/api/me/workouts/workout-1/visibility', 'PUT', {
          visibility: 'private',
          decisionRevision: 0,
          policyRevision: stopped.sharing.policyRevision,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(db, token, '/api/state', 'PUT', {
          ...sync,
          operationId: 'stale-sharing-intent',
          baseRevision: 1,
        })
      ).status,
    ).toBe(200);
    expect(
      ((await (await call(db, token, '/api/community/feed')).json()) as any).items,
    ).toHaveLength(0);
    expect(
      db.db
        .prepare('SELECT visibility FROM workout_visibility WHERE account_id=? AND workout_id=?')
        .get(session.accountId, 'workout-1'),
    ).toEqual({ visibility: 'private' });
    db.db.close();
  });

  it('rejects verified identity collisions and disabled account access', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(jwks)),
    );
    const db = new TestD1();
    const original = await auth('first@example.test', 'stable-subject');
    const initial = await call(db, original, '/api/session');
    expect(initial.status).toBe(200);
    const permitted = (await initial.json()) as any;
    expect(permitted.coachEnabled).toBe(true);
    db.db.prepare('UPDATE accounts SET coach_enabled=0 WHERE id=?').run(permitted.accountId);
    expect(((await (await call(db, original, '/api/session')).json()) as any).coachEnabled).toBe(
      true,
    );
    const enabled = await auth('enabled@example.test', 'enabled-subject');
    expect(((await (await call(db, enabled, '/api/session')).json()) as any).coachEnabled).toBe(
      true,
    );
    expect(
      ((await (await call(db, enabled, '/api/session', 'GET', undefined, {})).json()) as any)
        .coachEnabled,
    ).toBe(true);
    const other = await auth('other@example.test', 'other-subject');
    expect(((await (await call(db, other, '/api/session')).json()) as any).coachEnabled).toBe(true);
    expect(
      (await call(db, await auth('second@example.test', 'stable-subject'), '/api/session')).status,
    ).toBe(403);
    expect(
      (await call(db, await auth('first@example.test', 'different-subject'), '/api/session'))
        .status,
    ).toBe(403);

    const disabledToken = await auth('disabled@example.test', 'disabled-subject');
    const disabledSession = await call(db, disabledToken, '/api/session');
    expect(disabledSession.status).toBe(200);
    db.db
      .prepare(
        "UPDATE accounts SET status='disabled' WHERE email_normalized='disabled@example.test'",
      )
      .run();
    expect((await call(db, disabledToken, '/api/session')).status).toBe(403);
  });

  it('publishes only synchronized completed workout fields, enforces blocks, and hides stale projections', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(jwks)),
    );
    const db = new TestD1(),
      owner = await auth('owner@example.test', 'owner-sub'),
      member = await auth('member@example.test', 'member-sub');
    const ownerSession = await call(db, owner, '/api/session');
    expect(ownerSession.status).toBe(200);
    const os = (await ownerSession.json()) as any;
    expect(os.coachEnabled).toBe(true);
    expect(os.sharing.autoPublishWorkouts).toBe(false);
    let consent = await call(db, owner, '/api/me/sharing', 'PATCH', {
      summaryEnabled: false,
      autoPublishWorkouts: true,
      policyRevision: os.sharing.policyRevision,
      audienceAcknowledged: true,
    });
    expect(consent.status).toBe(200);
    const optedIn = (await consent.json()) as any;
    expect(optedIn.coachEnabled).toBe(true);
    const data = finishedData();
    const prior = structuredClone(data.workouts[0]);
    prior.id = 'pre-consent-workout';
    prior.startedAt = new Date(Date.now() - 86_400_000).toISOString();
    prior.completedAt = new Date(Date.now() - 86_370_000).toISOString();
    prior.exercises[0].actualSets[0].id = 'prior-set';
    prior.exercises[0].actualSets[0].completedAt = prior.completedAt;
    data.workouts.push(prior);
    expect(catalog.find((e) => e.id === 'ex_barbell-bench-press')?.name).toBe(
      'Barbell bench press',
    );
    const synced = await call(db, owner, '/api/state', 'PUT', {
      accountId: os.accountId,
      operationId: 'sync-1',
      deviceId: 'device-1',
      baseRevision: 0,
      data,
    });
    expect(synced.status).toBe(200);
    expect(
      db.db.prepare("SELECT exercise_id FROM training_sets WHERE workout_id='workout-1'").all(),
    ).toEqual([{ exercise_id: 'ex_barbell-bench-press' }]);
    const feed = await call(db, member, '/api/community/feed');
    expect(feed.status).toBe(200);
    const page = (await feed.json()) as any;
    expect(page.items).toHaveLength(1);
    expect(page.items[0].profile.publicId).toBe(os.profile.publicId);
    expect(page.items[0].title).toBe('Upper session');
    expect(page.items[0].setCount).toBe(1);
    expect(page.items[0].exerciseNames).toEqual(['Bench press']);
    expect(JSON.stringify(page)).not.toContain('private note');
    expect(JSON.stringify(page)).not.toContain('synthetic private exercise note');
    expect(JSON.stringify(page)).not.toContain('synthetic persistent instruction private');
    expect(JSON.stringify(page)).not.toContain('synthetic persistent setting private');
    const sharedProfile = await call(db, member, `/api/community/profiles/${os.profile.publicId}`);
    const sharedProfileBody = (await sharedProfile.json()) as any;
    expect(sharedProfileBody.scope).toBe('shared-workouts');
    expect(sharedProfileBody.statsVisible).toBe(false);
    expect(sharedProfileBody.records).toHaveLength(0);
    expect(sharedProfileBody.exerciseStats).toEqual([]);
    expect(sharedProfileBody.workouts).toHaveLength(1);
    expect(JSON.stringify(sharedProfileBody)).not.toContain('private note');
    expect(JSON.stringify(sharedProfileBody)).not.toContain('synthetic private exercise note');
    expect(JSON.stringify(sharedProfileBody)).not.toContain(
      'synthetic persistent instruction private',
    );
    expect(JSON.stringify(sharedProfileBody)).not.toContain('synthetic persistent setting private');
    const profileHistory = await call(
      db,
      member,
      `/api/community/profiles/${os.profile.publicId}/workouts`,
    );
    expect(profileHistory.status).toBe(200);
    const profileHistoryBody = await profileHistory.json();
    expect(JSON.stringify(profileHistoryBody)).not.toContain('private note');
    expect(JSON.stringify(profileHistoryBody)).not.toContain('synthetic private exercise note');
    expect(JSON.stringify(profileHistoryBody)).not.toContain(
      'synthetic persistent instruction private',
    );
    expect(JSON.stringify(profileHistoryBody)).not.toContain(
      'synthetic persistent setting private',
    );
    const ownerState = await call(db, owner, '/api/state');
    expect(ownerState.status).toBe(200);
    const ownData = ((await ownerState.json()) as any).data;
    expect(ownData.workouts[0].notes).toBe('private note');
    expect(ownData.workouts[0].exercises[0].notes).toBe('synthetic private exercise note');
    expect(ownData.workouts[0].exercises[0].persistentNote).toBe(
      'synthetic persistent instruction private',
    );
    expect(ownData.exerciseSettings['ex_barbell-bench-press'].persistentNote).toBe(
      'synthetic persistent setting private',
    );
    const memberState = await call(db, member, '/api/state');
    const memberData = await memberState.json();
    expect(JSON.stringify(memberData)).not.toContain('private note');
    expect(JSON.stringify(memberData)).not.toContain('synthetic private exercise note');
    expect(JSON.stringify(memberData)).not.toContain('synthetic persistent instruction private');
    expect(JSON.stringify(memberData)).not.toContain('synthetic persistent setting private');
    expect(
      db.db
        .prepare("SELECT visibility FROM workout_visibility WHERE workout_id='pre-consent-workout'")
        .get(),
    ).toEqual({ visibility: 'private' });
    db.db
      .prepare("DELETE FROM training_sets WHERE account_id=? AND workout_id='workout-1'")
      .run(os.accountId);
    db.db
      .prepare('UPDATE training_projection_state SET source_revision=0 WHERE account_id=?')
      .run(os.accountId);
    expect(
      (
        await call(db, owner, '/api/state', 'PUT', {
          accountId: os.accountId,
          operationId: 'sync-1',
          deviceId: 'device-1',
          baseRevision: 0,
          data,
        })
      ).status,
    ).toBe(200);
    const repopulated = ((await (await call(db, member, '/api/community/feed')).json()) as any)
      .items[0];
    expect(repopulated.id).toBe(page.items[0].id);
    db.db
      .prepare('UPDATE account_state SET revision=revision+1 WHERE account_id=?')
      .run(os.accountId);
    expect(
      ((await (await call(db, member, '/api/community/feed')).json()) as any).items,
    ).toHaveLength(0);
    db.db
      .prepare('UPDATE account_state SET revision=revision-1 WHERE account_id=?')
      .run(os.accountId);
    const detailResponse = await call(db, member, `/api/community/workouts/${page.items[0].id}`);
    const detail = (await detailResponse.json()) as any;
    expect(detail.exercises[0].name).toBe('Bench press');
    expect(detail.exercises[0].sets[0]).toMatchObject({
      weight: 100,
      reps: 8,
      kind: 'working',
      loadMode: 'external',
    });
    expect(JSON.stringify(detail)).not.toContain('private note');
    expect(detail).not.toHaveProperty('notes');
    expect(detail.exercises[0]).not.toHaveProperty('notes');
    expect(detail.exercises[0]).not.toHaveProperty('feeling');
    expect(detail.exercises[0]).not.toHaveProperty('repsInReserve');
    expect(JSON.stringify(detail)).not.toContain('synthetic private exercise note');
    expect(JSON.stringify(detail)).not.toContain('synthetic persistent instruction private');
    expect(JSON.stringify(detail)).not.toContain('synthetic persistent setting private');
    expect(JSON.stringify(detail)).not.toContain('owner@example.test');
    const privateDecision = await call(db, owner, '/api/me/workouts/workout-1/visibility', 'PUT', {
      visibility: 'private',
      decisionRevision: 0,
      policyRevision: optedIn.sharing.policyRevision,
    });
    expect(privateDecision.status).toBe(200);
    expect(
      ((await (await call(db, member, '/api/community/feed')).json()) as any).items,
    ).toHaveLength(0);
    const republish = await call(db, owner, '/api/me/workouts/workout-1/visibility', 'PUT', {
      visibility: 'community',
      decisionRevision: 1,
      policyRevision: optedIn.sharing.policyRevision,
      audienceAcknowledged: true,
    });
    expect(republish.status).toBe(200);
    const republished = ((await (await call(db, member, '/api/community/feed')).json()) as any)
      .items[0];
    expect(republished.id).toBe(page.items[0].id);
    expect(republished.activityAt).toBe(page.items[0].activityAt);
    const blocked = await call(
      db,
      member,
      `/api/community/profiles/${os.profile.publicId}/block`,
      'POST',
    );
    expect(blocked.status).toBe(204);
    expect((await call(db, member, '/api/community/feed')).status).toBe(200);
    expect(
      ((await (await call(db, member, '/api/community/feed')).json()) as any).items,
    ).toHaveLength(0);
    expect((await call(db, member, `/api/community/workouts/${page.items[0].id}`)).status).toBe(
      404,
    );
    expect(
      (
        await call(
          db,
          owner,
          `/api/community/profiles/${((await (await call(db, member, '/api/session')).json()) as any).profile.publicId}`,
        )
      ).status,
    ).toBe(404);
    const restored = await call(db, owner, '/api/state', 'PUT', {
      accountId: os.accountId,
      operationId: 'sync-restore',
      deviceId: 'device-1',
      baseRevision: 1,
      restore: true,
      data,
    });
    expect(restored.status).toBe(200);
    expect(
      ((await (await call(db, owner, '/api/session')).json()) as any).sharing.autoPublishWorkouts,
    ).toBe(false);
    await call(db, member, `/api/community/profiles/${os.profile.publicId}/block`, 'DELETE');
    expect(
      ((await (await call(db, member, '/api/community/feed')).json()) as any).items,
    ).toHaveLength(0);
    expect((await call(db, owner, '/api/state', 'DELETE')).status).toBe(204);
    expect(db.db.prepare('SELECT COUNT(*) count FROM workout_publications').get()).toEqual({
      count: 0,
    });
    db.db
      .prepare('UPDATE account_state SET revision=revision+1 WHERE account_id=?')
      .run(os.accountId);
    expect(
      ((await (await call(db, member, '/api/community/feed')).json()) as any).items,
    ).toHaveLength(0);
    db.db.close();
  });
  it('withdraws a shared workout when a sync correction removes all completed working sets', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(jwks)),
    );
    const db = new TestD1(),
      owner = await auth('owner@example.test', 'owner-sub'),
      member = await auth('member@example.test', 'member-sub'),
      ownerSession = (await (await call(db, owner, '/api/session')).json()) as any,
      data = finishedData(),
      completedWorkingSet = structuredClone(data.workouts[0].exercises[0].actualSets[0]);

    expect(
      (
        await call(db, owner, '/api/state', 'PUT', {
          accountId: ownerSession.accountId,
          operationId: 'publishable-sync',
          deviceId: 'device-1',
          baseRevision: 0,
          data,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(db, owner, '/api/me/workouts/workout-1/visibility', 'PUT', {
          visibility: 'community',
          decisionRevision: 0,
          policyRevision: ownerSession.sharing.policyRevision,
          audienceAcknowledged: true,
        })
      ).status,
    ).toBe(200);
    const publishedFeed = ((await (await call(db, member, '/api/community/feed')).json()) as any)
      .items;
    expect(publishedFeed).toHaveLength(1);
    const publicationId = publishedFeed[0].id;

    data.workouts[0].exercises[0].actualSets = [{ ...completedWorkingSet, kind: 'warmup' }];
    expect(
      (
        await call(db, owner, '/api/state', 'PUT', {
          accountId: ownerSession.accountId,
          operationId: 'remove-completed-sets',
          deviceId: 'device-1',
          baseRevision: 1,
          data,
        })
      ).status,
    ).toBe(200);
    expect(
      ((await (await call(db, member, '/api/community/feed')).json()) as any).items,
    ).toHaveLength(0);
    expect(
      db.db
        .prepare(
          "SELECT visibility,decision_revision decisionRevision FROM workout_visibility WHERE workout_id='workout-1'",
        )
        .get(),
    ).toEqual({ visibility: 'private', decisionRevision: 2 });
    expect((await call(db, member, `/api/community/workouts/${publicationId}`)).status).toBe(404);
    const sharedHistory = (await (
      await call(db, member, `/api/community/profiles/${ownerSession.profile.publicId}/workouts`)
    ).json()) as any;
    expect(sharedHistory.items).toHaveLength(0);

    expect(
      (
        await call(db, owner, '/api/state', 'PUT', {
          accountId: ownerSession.accountId,
          operationId: 'repeat-correction',
          deviceId: 'device-1',
          baseRevision: 2,
          data,
        })
      ).status,
    ).toBe(200);
    expect(
      db.db
        .prepare(
          "SELECT visibility,decision_revision decisionRevision FROM workout_visibility WHERE workout_id='workout-1'",
        )
        .get(),
    ).toEqual({ visibility: 'private', decisionRevision: 2 });

    data.workouts[0].exercises[0].actualSets = [completedWorkingSet];
    expect(
      (
        await call(db, owner, '/api/state', 'PUT', {
          accountId: ownerSession.accountId,
          operationId: 'restore-working-set',
          deviceId: 'device-1',
          baseRevision: 3,
          data,
        })
      ).status,
    ).toBe(200);
    expect(
      db.db
        .prepare(
          "SELECT visibility,decision_revision decisionRevision FROM workout_visibility WHERE workout_id='workout-1'",
        )
        .get(),
    ).toEqual({ visibility: 'private', decisionRevision: 2 });
    expect(
      (
        await call(db, owner, '/api/me/workouts/workout-1/visibility', 'PUT', {
          visibility: 'community',
          decisionRevision: 2,
          policyRevision: ownerSession.sharing.policyRevision,
          audienceAcknowledged: true,
        })
      ).status,
    ).toBe(200);
    expect(
      ((await (await call(db, member, '/api/community/feed')).json()) as any).items[0].id,
    ).toBe(publicationId);
    db.db.close();
  });
  it('rejects cross-account and missing production sync account identifiers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(jwks)),
    );
    const db = new TestD1(),
      token = await auth('owner@example.test', 'owner-sub'),
      session = (await (await call(db, token, '/api/session')).json()) as any;
    expect(
      (
        await call(db, token, '/api/state', 'PUT', {
          accountId: 'other-account',
          operationId: 'x',
          deviceId: 'd',
          baseRevision: 0,
          data: emptyData(),
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call(db, token, '/api/state', 'PUT', {
          operationId: 'y',
          deviceId: 'd',
          baseRevision: 0,
          data: emptyData(),
        })
      ).status,
    ).toBe(409);
    expect(session.accountId).not.toBe('other-account');
    db.db.close();
  });

  it('maps a verified legacy subject without losing state and enables Coach for the active member', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(jwks)),
    );
    const db = new TestD1(),
      subject = 'existing-owner-subject',
      token = await auth('owner@example.test', subject);
    const digest = new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(subject)),
    );
    const legacyId = `access:${[...digest].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
    const backup = JSON.stringify(emptyData()),
      now = '2026-10-18T00:00:00.000Z';
    db.db
      .prepare('INSERT INTO legacy_account_state VALUES (?,?,?,?,?,?)')
      .run(legacyId, backup, 4, now, 'legacy-device', 'legacy-op');
    db.db.prepare('INSERT INTO legacy_state_chunks VALUES (?,?,?)').run(legacyId, 0, backup);
    db.db
      .prepare('INSERT INTO legacy_sync_receipts VALUES (?,?,?,?,?)')
      .run(legacyId, 'legacy-op', 4, now, 'legacy-fingerprint');
    db.db
      .prepare('INSERT INTO legacy_coach_requests VALUES (?,?,?)')
      .run(legacyId, 'legacy-request', now);
    const response = await call(db, token, '/api/session');
    expect(response.status).toBe(200);
    const session = (await response.json()) as any;
    expect(session.coachEnabled).toBe(true);
    expect(session.accountId).toMatch(/^[0-9a-f-]{36}$/);
    const state = await call(db, token, '/api/state');
    expect(((await state.json()) as any).revision).toBe(4);
    expect(db.db.prepare('SELECT COUNT(*) count FROM legacy_account_state').get()).toEqual({
      count: 0,
    });
    expect(db.db.prepare('SELECT fingerprint FROM sync_receipts').get()).toEqual({
      fingerprint: 'legacy-fingerprint',
    });
    db.db.close();
  });
});

describe('incremental D1 training projections', () => {
  const changedRows = (db: TestD1, table: string) =>
    db.writes
      .filter((w) =>
        new RegExp('^(?:INSERT(?: OR IGNORE)? INTO|UPDATE|DELETE FROM) ' + table + '\\b', 'i').test(
          w.sql,
        ),
      )
      .reduce((sum, w) => sum + w.changes, 0);

  async function setup(shared = false) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(jwks)),
    );
    const db = new TestD1(),
      owner = await auth('delta@example.test', 'delta-owner');
    let session = (await (await call(db, owner, '/api/session')).json()) as any;
    if (shared) {
      const response = await call(db, owner, '/api/me/sharing', 'PATCH', {
        summaryEnabled: true,
        autoPublishWorkouts: true,
        policyRevision: session.sharing.policyRevision,
        audienceAcknowledged: true,
      });
      expect(response.status).toBe(200);
      session = await response.json();
    }
    const put = (
      data: ReturnType<typeof finishedData>,
      baseRevision: number,
      operationId = 'delta-' + baseRevision,
      restore = false,
    ) =>
      call(db, owner, '/api/state', 'PUT', {
        accountId: session.accountId,
        deviceId: 'synthetic-delta',
        operationId,
        baseRevision,
        data,
        restore,
      });
    return { db, owner, session, put };
  }

  it.each([false, true])(
    'writes zero unchanged historical rows across 100 workouts (sharing=%s)',
    async (shared) => {
      const { db, owner, put } = await setup(shared);
      try {
        const data = finishedData();
        const template = structuredClone(data.workouts[0]);
        data.workouts = Array.from({ length: 100 }, (_, i) => {
          const w = structuredClone(template);
          w.id = 'synthetic-history-' + i;
          w.exercises[0].name = 'Synthetic snapshot bench';
          w.exercises[0].actualSets = Array.from({ length: 20 }, (_, j) => ({
            ...template.exercises[0].actualSets[0],
            id: 'set-' + j,
          }));
          return w;
        });
        expect((await put(data, 0)).status).toBe(200);
        db.writes = [];
        data.settings.profile.notes = 'Synthetic preference change';
        db.queries = [];
        expect((await put(data, 1)).status).toBe(200);
        expect(db.queries.some((sql) => /FROM training_(sets|workouts)\b/.test(sql))).toBe(false);
        expect(changedRows(db, 'training_sets')).toBe(0);
        expect(changedRows(db, 'training_workouts')).toBe(0);
        expect(changedRows(db, 'workout_publications')).toBe(0);
        expect(changedRows(db, 'workout_visibility')).toBe(0);
        expect(changedRows(db, 'training_projection_state')).toBe(1);
        // Three state/receipt changes plus the account projection marker. Index
        // maintenance is a D1 metric and is deliberately not estimated here.
        expect(db.writes.reduce((sum, w) => sum + w.changes, 0)).toBe(4);
        let revision = 2;
        const active = structuredClone(template);
        active.id = 'synthetic-active';
        active.status = 'active';
        delete active.completedAt;
        for (const change of [
          () => data.workouts.push(active),
          () => {
            active.exercises[0].actualSets[0].weight = 135;
          },
          () => data.routines.push(createRoutine('Synthetic routine')),
          () =>
            data.messages.push({
              id: 'synthetic-message',
              role: 'user',
              text: 'Synthetic Coach question',
              createdAt: new Date().toISOString(),
            }),
        ]) {
          change();
          db.writes = [];
          db.queries = [];
          expect((await put(data, revision++)).status).toBe(200);
          expect(db.queries.some((sql) => /FROM training_(sets|workouts)\b/.test(sql))).toBe(false);
          expect(changedRows(db, 'training_sets')).toBe(0);
          expect(changedRows(db, 'training_workouts')).toBe(0);
          expect(changedRows(db, 'workout_publications')).toBe(0);
        }
        if (shared) {
          const feed = (await (await call(db, owner, '/api/community/feed')).json()) as any;
          expect(feed.items).toHaveLength(20);
          expect(feed.items[0].exerciseNames).toEqual(['Synthetic snapshot bench']);
          const detail = (await (
            await call(db, owner, '/api/community/workouts/' + feed.items[0].id)
          ).json()) as any;
          expect(detail.exercises[0].name).toBe('Synthetic snapshot bench');
          expect(detail.exercises[0].sets).toHaveLength(20);
        }
        db.writes = [];
        expect((await put(data, revision - 1)).status).toBe(200);
        expect(db.writes.reduce((sum, w) => sum + w.changes, 0)).toBe(0);
        // More than one 500-row deletion chunk, retaining the workout metadata.
        for (const workout of data.workouts.slice(0, 40)) workout.exercises[0].actualSets = [];
        db.writes = [];
        expect((await put(data, revision)).status).toBe(200);
        expect(changedRows(db, 'training_sets')).toBe(800);
        expect(changedRows(db, 'training_workouts')).toBe(0);
        expect(db.db.prepare('SELECT COUNT(*) n FROM training_sets').get()).toEqual({ n: 1200 });
      } finally {
        db.db.close();
      }
    },
  );

  it('updates only corrected sets and removes only missing identities, including duplicate set IDs in different exercises', async () => {
    const { db, put } = await setup();
    try {
      const data = finishedData(),
        workout = data.workouts[0];
      const other = structuredClone(workout.exercises[0]);
      other.id = 'other-instance';
      workout.exercises.push(other);
      const second = structuredClone(workout);
      second.id = 'other-workout';
      data.workouts.push(second);
      expect((await put(data, 0)).status).toBe(200);
      db.writes = [];
      workout.exercises[0].actualSets[0].weight = 125;
      workout.exercises[1].actualSets[0].status = 'skipped';
      expect((await put(data, 1)).status).toBe(200);
      expect(changedRows(db, 'training_sets')).toBe(2);
      expect(changedRows(db, 'training_workouts')).toBe(0);
      expect(
        db.db
          .prepare(
            'SELECT workout_id,exercise_instance_id,weight_lb FROM training_sets ORDER BY workout_id,exercise_instance_id',
          )
          .all(),
      ).toEqual([
        { workout_id: 'other-workout', exercise_instance_id: 'instance-1', weight_lb: 100 },
        { workout_id: 'other-workout', exercise_instance_id: 'other-instance', weight_lb: 100 },
        { workout_id: 'workout-1', exercise_instance_id: 'instance-1', weight_lb: 125 },
      ]);
      db.writes = [];
      workout.exercises[0].id = 'replacement-instance';
      workout.exercises[0].actualSets.push({
        ...workout.exercises[0].actualSets[0],
        id: 'new-set',
      });
      data.workouts = [workout];
      expect((await put(data, 2)).status).toBe(200);
      expect(
        db.db
          .prepare(
            'SELECT workout_id,exercise_instance_id,set_id FROM training_sets ORDER BY set_id',
          )
          .all(),
      ).toEqual([
        {
          workout_id: 'workout-1',
          exercise_instance_id: 'replacement-instance',
          set_id: 'new-set',
        },
        { workout_id: 'workout-1', exercise_instance_id: 'replacement-instance', set_id: 'set-1' },
      ]);
      data.workouts = [];
      expect((await put(data, 3)).status).toBe(200);
      expect(db.db.prepare('SELECT COUNT(*) n FROM training_sets').get()).toEqual({ n: 0 });
      expect(db.db.prepare('SELECT COUNT(*) n FROM training_workouts').get()).toEqual({ n: 0 });
    } finally {
      db.db.close();
    }
  });

  it('preserves publication identity on title edits and withdraws a corrected last working set', async () => {
    const { db, owner, put } = await setup(true);
    try {
      const data = finishedData();
      expect((await put(data, 0)).status).toBe(200);
      const original = db.db.prepare('SELECT id,activity_at FROM workout_publications').get();
      data.workouts[0].name = 'Corrected synthetic title';
      db.writes = [];
      expect((await put(data, 1)).status).toBe(200);
      expect(changedRows(db, 'training_sets')).toBe(0);
      expect(changedRows(db, 'workout_publications')).toBe(1);
      expect(db.db.prepare('SELECT id,activity_at FROM workout_publications').get()).toEqual(
        original,
      );
      const feed = (await (await call(db, owner, '/api/community/feed')).json()) as any;
      expect(feed.items[0].title).toBe('Corrected synthetic title');
      data.workouts[0].exercises[0].actualSets[0].kind = 'warmup';
      expect((await put(data, 2)).status).toBe(200);
      expect(((await (await call(db, owner, '/api/community/feed')).json()) as any).items).toEqual(
        [],
      );
    } finally {
      db.db.close();
    }
  });

  it('restores identical history without rewriting sets and keeps restored workouts private on replay', async () => {
    const { db, owner, put } = await setup(true);
    try {
      const data = finishedData();
      expect((await put(data, 0)).status).toBe(200);
      db.writes = [];
      expect((await put(data, 1, 'restore-delta', true)).status).toBe(200);
      expect(changedRows(db, 'training_sets')).toBe(0);
      expect(changedRows(db, 'training_workouts')).toBe(0);
      const policy = db.db.prepare('SELECT policy_revision FROM sharing_settings').get();
      expect(((await (await call(db, owner, '/api/community/feed')).json()) as any).items).toEqual(
        [],
      );
      db.writes = [];
      expect((await put(data, 1, 'restore-delta', true)).status).toBe(200);
      expect(db.writes.reduce((sum, w) => sum + w.changes, 0)).toBe(0);
      expect(db.db.prepare('SELECT policy_revision FROM sharing_settings').get()).toEqual(policy);
    } finally {
      db.db.close();
    }
  });

  it('recalculates a delta when an older projection commits after its baseline read', async () => {
    const { db, owner, put } = await setup(true);
    try {
      const data = finishedData();
      expect((await put(data, 0)).status).toBe(200);
      // Revision 2 state was accepted, but its projection was delayed. Revision 3
      // reverts its load change. Commit that delayed projection after rev 3 reads
      // rev 1's baseline; an unguarded empty delta would leave the wrong load.
      db.db.prepare('UPDATE account_state SET revision=2').run();
      let injected = false;
      db.beforeBatch = async (sql) => {
        if (
          !injected &&
          sql.some((s) => s.startsWith('INSERT OR IGNORE INTO training_projection_state'))
        ) {
          injected = true;
          db.db.prepare('UPDATE training_sets SET weight_lb=150').run();
          db.db.prepare('UPDATE training_projection_state SET source_revision=2').run();
        }
      };
      expect((await put(data, 2)).status).toBe(200);
      expect(injected).toBe(true);
      expect(db.db.prepare('SELECT weight_lb FROM training_sets').get()).toEqual({
        weight_lb: 100,
      });
      expect(db.db.prepare('SELECT source_revision FROM training_projection_state').get()).toEqual({
        source_revision: 3,
      });
      // An out-of-date projection must still be unavailable to readers.
      db.db.prepare('UPDATE account_state SET revision=4').run();
      const feed = (await (await call(db, owner, '/api/community/feed')).json()) as any;
      expect(feed.items).toEqual([]);
    } finally {
      db.db.close();
    }
  });

  it('repairs an outdated projection instead of certifying it when finished training is unchanged', async () => {
    const { db, put } = await setup();
    try {
      const data = finishedData();
      expect((await put(data, 0)).status).toBe(200);
      db.db.prepare('UPDATE training_sets SET weight_lb=150').run();
      db.db.prepare('UPDATE training_projection_state SET source_revision=0').run();
      data.settings.profile.notes = 'Synthetic unrelated update';
      db.writes = [];
      expect((await put(data, 1)).status).toBe(200);
      expect(changedRows(db, 'training_sets')).toBe(1);
      expect(db.db.prepare('SELECT weight_lb FROM training_sets').get()).toEqual({
        weight_lb: 100,
      });
      expect(db.db.prepare('SELECT source_revision FROM training_projection_state').get()).toEqual({
        source_revision: 2,
      });
    } finally {
      db.db.close();
    }
  });

  it('rolls back failed projections and repairs a lost acknowledgement on retry', async () => {
    const { db, put } = await setup();
    try {
      const data = finishedData();
      expect((await put(data, 0)).status).toBe(200);
      data.workouts[0].exercises[0].actualSets[0].weight = 130;
      db.db.exec(
        "CREATE TRIGGER synthetic_projection_failure BEFORE UPDATE ON training_projection_state BEGIN SELECT RAISE(ABORT,'synthetic projection failure'); END;",
      );
      expect((await put(data, 1, 'failed-projection')).status).toBe(503);
      expect(db.db.prepare('SELECT weight_lb FROM training_sets').get()).toEqual({
        weight_lb: 100,
      });
      expect(db.db.prepare('SELECT source_revision FROM training_projection_state').get()).toEqual({
        source_revision: 1,
      });
      expect(db.db.prepare('SELECT revision FROM account_state').get()).toEqual({ revision: 2 });
      db.db.exec('DROP TRIGGER synthetic_projection_failure');
      db.writes = [];
      expect((await put(data, 1, 'failed-projection')).status).toBe(200);
      expect(changedRows(db, 'account_state')).toBe(0);
      expect(changedRows(db, 'training_sets')).toBe(1);
      expect(db.db.prepare('SELECT weight_lb FROM training_sets').get()).toEqual({
        weight_lb: 130,
      });
    } finally {
      db.db.close();
    }
  });
});

describe('Cloudflare request budgets', () => {
  it('updates only changed snapshot chunks and deletes surplus chunks after shrinking', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(jwks)),
    );
    const db = new TestD1();
    try {
      const token = await auth('chunk-budget@example.test', 'chunk-budget');
      const session = (await (await call(db, token, '/api/session')).json()) as any;
      const data = emptyData();
      data.settings.profile.notes = 'x'.repeat(2_200_000);
      const put = (baseRevision: number) =>
        call(db, token, '/api/state', 'PUT', {
          accountId: session.accountId,
          operationId: 'chunk-' + baseRevision,
          deviceId: 'synthetic',
          baseRevision,
          data,
        });
      const chunkWrites = () =>
        db.writes
          .filter((w) => /^(?:INSERT INTO|DELETE FROM) state_chunks/.test(w.sql))
          .reduce((sum, w) => sum + w.changes, 0);
      expect((await put(0)).status).toBe(200);
      expect(db.db.prepare('SELECT COUNT(*) n FROM state_chunks').get()).toEqual({ n: 3 });
      data.settings.profile.notes = data.settings.profile.notes.slice(0, -1) + 'y';
      db.writes = [];
      expect((await put(1)).status).toBe(200);
      expect(chunkWrites()).toBe(1);
      const stored = (await (await call(db, token, '/api/state')).json()) as any;
      expect(stored.data.settings.profile.notes).toBe(data.settings.profile.notes);
      db.writes = [];
      expect((await put(1)).status).toBe(200);
      expect(db.writes.reduce((sum, w) => sum + w.changes, 0)).toBe(0);
      data.settings.profile.notes = 'Synthetic smaller snapshot';
      db.writes = [];
      expect((await put(2)).status).toBe(200);
      expect(chunkWrites()).toBe(3);
      expect(db.db.prepare('SELECT chunk_index FROM state_chunks').all()).toEqual([
        { chunk_index: 0 },
      ]);
      expect(((await (await call(db, token, '/api/state')).json()) as any).data).toEqual(data);
    } finally {
      db.db.close();
    }
  });

  it('loads a full 20-author feed with five D1 queries and no writes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(jwks)),
    );
    const db = new TestD1();
    try {
      const tokens: string[] = [];
      for (let i = 0; i < 20; i++) {
        const token = await auth('budget-' + i + '@example.test', 'budget-' + i);
        tokens.push(token);
        const session = (await (await call(db, token, '/api/session')).json()) as any;
        expect(
          (
            await call(db, token, '/api/me/sharing', 'PATCH', {
              summaryEnabled: false,
              autoPublishWorkouts: true,
              policyRevision: session.sharing.policyRevision,
              audienceAcknowledged: true,
            })
          ).status,
        ).toBe(200);
        const data = finishedData();
        // Workout and set IDs intentionally repeat across owners.
        data.workouts[0].name = 'Synthetic author ' + i;
        data.workouts[0].exercises[0].name = 'Synthetic exercise ' + i;
        const warmup = structuredClone(data.workouts[0].exercises[0]);
        warmup.id = 'warmup-instance';
        warmup.actualSets[0].kind = 'warmup';
        data.workouts[0].exercises.push(warmup);
        expect(
          (
            await call(db, token, '/api/state', 'PUT', {
              accountId: session.accountId,
              operationId: 'budget-sync',
              deviceId: 'synthetic',
              baseRevision: 0,
              data,
            })
          ).status,
        ).toBe(200);
      }
      db.queries = [];
      db.writes = [];
      const response = await call(db, tokens[0], '/api/community/feed');
      expect(response.status).toBe(200);
      const feed = (await response.json()) as any;
      expect(feed.items).toHaveLength(20);
      for (const item of feed.items) {
        const author = item.title.replace('Synthetic author ', '');
        expect(item.exerciseNames).toEqual(['Synthetic exercise ' + author]);
        expect(item.exerciseCount).toBe(2);
        expect(item.setCount).toBe(1);
      }
      expect(db.queries).toHaveLength(5);
      expect(db.writes.reduce((sum, write) => sum + write.changes, 0)).toBe(0);
      // Empty feeds should not load any private history snapshots.
      db.db.prepare("UPDATE workout_visibility SET visibility='private'").run();
      db.queries = [];
      expect(
        ((await (await call(db, tokens[0], '/api/community/feed')).json()) as any).items,
      ).toEqual([]);
      expect(db.queries).toHaveLength(2);
    } finally {
      db.db.close();
    }
  });

  it('reads one coherent saved snapshot per sync rather than reading it again for the version check', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(jwks)),
    );
    const db = new TestD1();
    try {
      const token = await auth('snapshot-budget@example.test', 'snapshot-budget');
      const session = (await (await call(db, token, '/api/session')).json()) as any;
      db.queries = [];
      expect(
        (
          await call(db, token, '/api/state', 'PUT', {
            accountId: session.accountId,
            operationId: 'snapshot-budget',
            deviceId: 'synthetic',
            baseRevision: 0,
            data: emptyData(),
          })
        ).status,
      ).toBe(200);
      expect(
        db.queries.filter((sql) => sql.includes('SELECT content FROM state_chunks')),
      ).toHaveLength(1);
    } finally {
      db.db.close();
    }
  });
});

describe('concurrent sync receipt integrity', () => {
  it.each([0, 1])(
    'never mutates a committed operation when another request reuses its ID (base revision %s)',
    async (baseRevision) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Response.json(jwks)),
      );
      const db = new TestD1();
      try {
        const token = await auth('receipt-race@example.test', 'receipt-race');
        const session = (await (await call(db, token, '/api/session')).json()) as any;
        const committed = finishedData();
        committed.settings.profile.notes = 'x'.repeat(2_200_000);
        const competing = finishedData();
        competing.workouts[0].name = 'Rejected competing snapshot';
        const request = (data: typeof committed, base: number) =>
          call(db, token, '/api/state', 'PUT', {
            accountId: session.accountId,
            operationId: 'shared-operation',
            deviceId: 'synthetic',
            baseRevision: base,
            data,
          });
        let overlapped = false;
        db.beforeBatch = async (sql) => {
          if (!sql.some((statement) => statement.startsWith('UPDATE account_state SET'))) return;
          db.beforeBatch = undefined;
          // Both requests checked the receipt before the winner committed.
          expect((await request(committed, 0)).status).toBe(200);
          overlapped = true;
          db.writes = [];
        };
        expect((await request(competing, baseRevision)).status).toBe(400);
        expect(overlapped).toBe(true);
        expect(db.writes.reduce((sum, write) => sum + write.changes, 0)).toBe(0);
        const saved = (await (await call(db, token, '/api/state')).json()) as any;
        expect(saved.revision).toBe(1);
        expect(saved.data).toEqual(committed);
        expect(db.db.prepare('SELECT COUNT(*) n FROM state_chunks').get()).toEqual({ n: 3 });
        expect(
          db.db.prepare('SELECT source_revision FROM training_projection_state').get(),
        ).toEqual({ source_revision: 1 });
      } finally {
        db.db.close();
      }
    },
  );
});
