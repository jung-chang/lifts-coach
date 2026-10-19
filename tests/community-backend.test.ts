import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import worker from '../worker/index';
import { emptyData } from '../shared/domain';
import { catalog } from '../shared/catalog';

class TestD1 {
  db = new DatabaseSync(':memory:');
  constructor() {
    for (const file of [
      '0001_initial.sql',
      '0002_state_chunks.sql',
      '0003_account_isolation.sql',
      '0004_accounts_community.sql',
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
        const r = this.db.prepare(sql).run(...(values as never[]));
        return { success: true, meta: { changes: Number(r.changes) } };
      },
    };
    return statement;
  }
  async batch(statements: ReturnType<TestD1['prepare']>[]) {
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
  coachOwnerEmail = 'enabled@example.test',
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
      COACH_OWNER_EMAIL: coachOwnerEmail,
    } as never,
    {} as ExecutionContext,
  );
}
function finishedData() {
  const data = emptyData(),
    completedAt = new Date().toISOString(),
    startedAt = completedAt;
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
    expect(session.coachEnabled).toBe(false);
    expect(await (await call(db, token, '/api/providers')).json()).toEqual([]);
    expect((await call(db, token, '/api/coach/chat', 'POST', { message: 'hello' })).status).toBe(
      403,
    );
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
    expect(permitted.coachEnabled).toBe(false);
    db.db.prepare('UPDATE accounts SET coach_enabled=1 WHERE id=?').run(permitted.accountId);
    expect(((await (await call(db, original, '/api/session')).json()) as any).coachEnabled).toBe(
      false,
    );
    const enabled = await auth('enabled@example.test', 'enabled-subject');
    expect(((await (await call(db, enabled, '/api/session')).json()) as any).coachEnabled).toBe(
      true,
    );
    expect(
      ((await (await call(db, enabled, '/api/session', 'GET', undefined, '')).json()) as any)
        .coachEnabled,
    ).toBe(false);
    const other = await auth('other@example.test', 'other-subject');
    expect(((await (await call(db, other, '/api/session')).json()) as any).coachEnabled).toBe(
      false,
    );
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
    expect(os.coachEnabled).toBe(false);
    expect(os.sharing.autoPublishWorkouts).toBe(false);
    let consent = await call(db, owner, '/api/me/sharing', 'PATCH', {
      summaryEnabled: false,
      autoPublishWorkouts: true,
      policyRevision: os.sharing.policyRevision,
      audienceAcknowledged: true,
    });
    expect(consent.status).toBe(200);
    const optedIn = (await consent.json()) as any;
    expect(optedIn.coachEnabled).toBe(false);
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
    expect(page.items[0].title).toMatch(/^Workout · /);
    expect(page.items[0].setCount).toBe(1);
    expect(page.items[0].exerciseNames).toEqual(['Barbell bench press']);
    const sharedProfile = await call(db, member, `/api/community/profiles/${os.profile.publicId}`);
    const sharedProfileBody = (await sharedProfile.json()) as any;
    expect(sharedProfileBody.scope).toBe('shared-workouts');
    expect(sharedProfileBody.records).toHaveLength(1);
    expect(sharedProfileBody.workouts).toHaveLength(1);
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
    expect(detail.exercises[0].sets[0]).toMatchObject({
      weight: 100,
      reps: 8,
      kind: 'working',
      loadMode: 'external',
    });
    expect(JSON.stringify(detail)).not.toContain('private note');
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

  it('maps a verified legacy subject without losing state or granting Coach permission', async () => {
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
    expect(session.coachEnabled).toBe(false);
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
