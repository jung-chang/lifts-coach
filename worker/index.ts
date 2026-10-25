/// <reference types="@cloudflare/workers-types" />
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { verifiedIdentity, legacySubjectKey } from './auth';
import { CoachError, coachReply, providers } from './coach';
import type { ProviderEnv } from './coach';
import { emptyData, validateBackup } from '../shared/domain';
import { catalog } from '../shared/catalog';
import { splitState } from './chunks';
import { personalRecordsFromWorkouts, recordKey } from '../shared/personalRecords';
import type { LoadMode } from '../shared/types';
import type { ExerciseStat } from '../shared/trainingStats';

interface Env extends ProviderEnv {
  DB: D1Database;
  ASSETS: Fetcher;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  LOCAL_DEV?: string;
}
type Variables = { accountId: string; coachEnabled: boolean };
const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use(
  '/api/*',
  bodyLimit({
    maxSize: 20_000_000,
    onError: (c) =>
      c.json(
        {
          error:
            'This prototype synchronizes backups up to 20 MB. Export your local data before upgrading storage.',
        },
        413,
      ),
  }),
);
app.use('/api/*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  const identity = await verifiedIdentity(c.req.raw, c.env);
  if (!identity) return c.json({ error: 'Cloudflare Access authentication is required.' }, 401);
  const account = await resolveAccount(c.env, identity);
  if (!account) return c.json({ error: 'Account access is unavailable.' }, 403);
  c.set('accountId', account.id);
  c.set('coachEnabled', account.coach_enabled === 1);
  const requestedAccount = c.req.header('X-Lifts-Account');
  if (requestedAccount && requestedAccount !== account.id)
    return c.json({ error: 'Account identity changed. Refresh your session.' }, 409);
  if (!['GET', 'HEAD'].includes(c.req.method)) {
    const origin = c.req.header('origin');
    const url = new URL(c.req.url);
    const devOrigin =
      origin &&
      c.env.LOCAL_DEV === 'true' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
      ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname);
    if (origin && origin !== url.origin && !devOrigin)
      return c.json({ error: 'Cross-origin writes are not allowed.' }, 403);
  }
  await next();
});

async function resolveAccount(
  env: Env,
  identity: { issuer: string; subject: string; email: string; local?: boolean },
) {
  const now = new Date().toISOString(),
    normalized = identity.email.trim().toLowerCase();
  // Every active account admitted through Access can use the provisioned Coach.
  const coach = 1;
  const found = await env.DB.prepare(
    'SELECT id,email,email_normalized emailNormalized,status,coach_enabled FROM accounts WHERE access_issuer = ? AND access_subject = ?',
  )
    .bind(identity.issuer, identity.subject)
    .first<{
      id: string;
      email: string;
      emailNormalized: string;
      status: string;
      coach_enabled: number;
    }>();
  if (found && found.emailNormalized !== normalized) return null;
  if (found) {
    if (found.status !== 'active') return null;
    if (found.coach_enabled !== coach) {
      const updated = await env.DB.prepare(
        "UPDATE accounts SET coach_enabled=?,updated_at=? WHERE id=? AND status='active'",
      )
        .bind(coach, now, found.id)
        .run();
      if (!updated.meta.changes) return null;
      found.coach_enabled = coach;
    }
    return found;
  }
  const collision = await env.DB.prepare('SELECT id FROM accounts WHERE email_normalized = ?')
    .bind(normalized)
    .first();
  if (collision) return null;
  const id = await identityUuid(identity.issuer, identity.subject);
  const legacyId = identity.local ? null : await legacySubjectKey(identity.subject);
  const publicId = crypto.randomUUID();
  const displayName = `Member ${publicId.slice(0, 4)}`;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO accounts (id,email,email_normalized,access_issuer,access_subject,status,coach_enabled,created_at,updated_at) VALUES (?,?,?,?,?,'active',?,?,?)",
    ).bind(id, identity.email, normalized, identity.issuer, identity.subject, coach, now, now),
    env.DB.prepare(
      "INSERT OR IGNORE INTO profiles (account_id,public_id,display_name,training_timezone,created_at,updated_at) SELECT id,?,?,'UTC',?,? FROM accounts WHERE access_issuer=? AND access_subject=?",
    ).bind(publicId, displayName, now, now, identity.issuer, identity.subject),
    env.DB.prepare(
      'INSERT OR IGNORE INTO sharing_settings (account_id,updated_at) SELECT id,? FROM accounts WHERE access_issuer=? AND access_subject=?',
    ).bind(now, identity.issuer, identity.subject),
    env.DB.prepare(
      "INSERT OR IGNORE INTO account_state (account_id,payload,revision,updated_at,device_id,last_operation_id) SELECT id,COALESCE((SELECT payload FROM legacy_account_state WHERE id=?),?),COALESCE((SELECT revision FROM legacy_account_state WHERE id=?),0),COALESCE((SELECT updated_at FROM legacy_account_state WHERE id=?),?),COALESCE((SELECT device_id FROM legacy_account_state WHERE id=?),''),COALESCE((SELECT last_operation_id FROM legacy_account_state WHERE id=?),'') FROM accounts WHERE access_issuer=? AND access_subject=?",
    ).bind(
      legacyId ?? '',
      JSON.stringify(emptyData()),
      legacyId ?? '',
      legacyId ?? '',
      now,
      legacyId ?? '',
      legacyId ?? '',
      identity.issuer,
      identity.subject,
    ),
    ...(legacyId
      ? [
          env.DB.prepare(
            'INSERT OR IGNORE INTO state_chunks SELECT (SELECT id FROM accounts WHERE access_issuer=? AND access_subject=?),chunk_index,content FROM legacy_state_chunks WHERE account_id=?',
          ).bind(identity.issuer, identity.subject, legacyId),
          env.DB.prepare(
            'INSERT OR IGNORE INTO sync_receipts SELECT (SELECT id FROM accounts WHERE access_issuer=? AND access_subject=?),operation_id,revision,created_at,fingerprint FROM legacy_sync_receipts WHERE account_id=?',
          ).bind(identity.issuer, identity.subject, legacyId),
          env.DB.prepare(
            'INSERT OR IGNORE INTO coach_requests SELECT (SELECT id FROM accounts WHERE access_issuer=? AND access_subject=?),id,created_at FROM legacy_coach_requests WHERE account_id=?',
          ).bind(identity.issuer, identity.subject, legacyId),
          env.DB.prepare('DELETE FROM legacy_state_chunks WHERE account_id=?').bind(legacyId),
          env.DB.prepare('DELETE FROM legacy_sync_receipts WHERE account_id=?').bind(legacyId),
          env.DB.prepare('DELETE FROM legacy_coach_requests WHERE account_id=?').bind(legacyId),
          env.DB.prepare('DELETE FROM legacy_account_state WHERE id=?').bind(legacyId),
        ]
      : []),
  ]);
  const current = await env.DB.prepare(
    'SELECT id,email,status,coach_enabled FROM accounts WHERE access_issuer=? AND access_subject=?',
  )
    .bind(identity.issuer, identity.subject)
    .first<{ id: string; email: string; status: string; coach_enabled: number }>();
  if (!current || current.status !== 'active') return null;
  if (current.coach_enabled !== coach) {
    await env.DB.prepare(
      "UPDATE accounts SET coach_enabled=?,updated_at=? WHERE id=? AND status='active'",
    )
      .bind(coach, now, current.id)
      .run();
    current.coach_enabled = coach;
  }
  return current;
}
async function identityUuid(issuer: string, subject: string) {
  const namespace = Uint8Array.from([
    0x6b, 0xa7, 0xb8, 0x10, 0x9d, 0xad, 0x11, 0xd1, 0x80, 0xb4, 0x00, 0xc0, 0x4f, 0xd4, 0x30, 0xc8,
  ]);
  const name = new TextEncoder().encode(`${issuer}\n${subject}`),
    input = new Uint8Array(namespace.length + name.length);
  input.set(namespace);
  input.set(name, namespace.length);
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-1', input)).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
async function readState(env: Env, accountId: string) {
  let state = await readRawState(env, accountId);
  if (!state) {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO account_state (account_id,payload,revision,updated_at,device_id,last_operation_id) VALUES (?,?,0,?,'','')",
    )
      .bind(accountId, JSON.stringify(emptyData()), new Date().toISOString())
      .run();
    state = await readRawState(env, accountId);
  }
  if (!state) throw new Error('Account state is unavailable.');
  return { data: validateBackup(state.data), revision: state.revision };
}
async function readRawState(env: Env, accountId: string) {
  // D1 batches execute transactionally: metadata and chunks must describe the
  // same revision even when another device is writing concurrently.
  const [metadata, contents] = await env.DB.batch([
    env.DB.prepare('SELECT payload, revision FROM account_state WHERE account_id = ?').bind(
      accountId,
    ),
    env.DB.prepare(
      'SELECT content FROM state_chunks WHERE account_id = ? ORDER BY chunk_index',
    ).bind(accountId),
  ]);
  const row = metadata.results[0] as { payload: string; revision: number };
  if (!row) return null;
  const chunks = contents.results as { content: string }[];
  return {
    data: JSON.parse(
      chunks.length ? chunks.map((chunk) => chunk.content).join('') : row.payload,
    ) as unknown,
    revision: row.revision,
  };
}
async function getSession(env: Env, accountId: string) {
  const row = await env.DB.prepare(
    `SELECT a.id accountId,a.email,a.coach_enabled coachEnabled,p.setup_completed_at setupCompletedAt,p.public_id publicId,p.display_name displayName,p.training_timezone trainingTimezone,s.summary_enabled summaryEnabled,s.auto_publish_workouts autoPublishWorkouts,s.policy_revision policyRevision,s.audience_acknowledged_at audienceAcknowledgedAt,s.workout_sharing_enabled_at enabledAt FROM accounts a JOIN profiles p ON p.account_id=a.id JOIN sharing_settings s ON s.account_id=a.id WHERE a.id=? AND a.status='active'`,
  )
    .bind(accountId)
    .first<Record<string, any>>();
  if (!row) throw new Error('Account session is unavailable.');
  return {
    accountId: row.accountId,
    email: row.email,
    coachEnabled: !!row.coachEnabled,
    profileSetupRequired: !row.setupCompletedAt,
    profile: {
      publicId: row.publicId,
      displayName: row.displayName,
      trainingTimezone: row.trainingTimezone,
    },
    sharing: {
      summaryEnabled: !!row.summaryEnabled,
      autoPublishWorkouts: !!row.autoPublishWorkouts,
      policyRevision: row.policyRevision,
      audienceAcknowledgedAt: row.audienceAcknowledgedAt,
      enabledAt: row.enabledAt,
    },
  };
}
function trainingDate(instant: string, timezone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(instant));
}
// Advance the complete account projection atomically without rewriting unchanged
// history. Workout source_revision records its last metadata change; readers
// still require the account projection marker to equal current account state.
async function rebuildProjection(
  env: Env,
  accountId: string,
  revision: number,
  data: ReturnType<typeof validateBackup>,
  restore: boolean,
  attempt = 0,
) {
  const alreadyProjected = await env.DB.prepare(
    'SELECT source_revision sourceRevision FROM training_projection_state WHERE account_id=?',
  )
    .bind(accountId)
    .first<{ sourceRevision: number }>();
  if (alreadyProjected?.sourceRevision === revision) return;
  const now = new Date().toISOString(),
    profile = await profileDto(env, accountId),
    settings = await env.DB.prepare(
      'SELECT auto_publish_workouts autoPublishWorkouts,audience_acknowledged_at audienceAcknowledgedAt,workout_sharing_enabled_at enabledAt,policy_revision policyRevision FROM sharing_settings WHERE account_id=?',
    )
      .bind(accountId)
      .first<Record<string, any>>();
  const valid = data.workouts.filter((w) => w.status === 'finished');
  const validIds = new Set(valid.map((w) => w.id));
  // Read a coherent baseline. The transaction below checks this revision again:
  // another request may finish a projection while we calculate the delta.
  const [projectionRows, existingRows, setRows] = await env.DB.batch([
    env.DB.prepare(
      'SELECT source_revision sourceRevision FROM training_projection_state WHERE account_id=?',
    ).bind(accountId),
    env.DB.prepare(
      'SELECT workout_id workoutId,started_at startedAt,training_date trainingDate,training_timezone trainingTimezone,completed_at completedAt FROM training_workouts WHERE account_id=?',
    ).bind(accountId),
    env.DB.prepare(
      'SELECT workout_id workoutId,set_id id,exercise_instance_id instanceId,exercise_id exerciseId,load_mode loadMode,weight_lb weight,reps,kind,completed_at completedAt FROM training_sets WHERE account_id=?',
    ).bind(accountId),
  ]);
  const projected = projectionRows.results[0] as { sourceRevision: number } | undefined;
  if (projected?.sourceRevision === revision) return;
  const baseline = projected?.sourceRevision ?? -1;
  if (!Number.isSafeInteger(baseline)) throw new Error('Invalid projection revision.');
  const existing = new Map(
    (existingRows.results as Record<string, string>[]).map((row) => [row.workoutId, row]),
  );
  const setKey = (set: Record<string, unknown>) =>
    JSON.stringify([set.workoutId, set.instanceId, set.id]);
  const existingSets = new Map(
    (setRows.results as Record<string, unknown>[]).map((set) => [setKey(set), set]),
  );
  const statements: ReturnType<Env['DB']['prepare']>[] = [];
  const currentGuard = `EXISTS(SELECT 1 FROM account_state WHERE account_id=? AND revision=? AND COALESCE((SELECT source_revision FROM training_projection_state WHERE account_id=account_state.account_id),-1)=${baseline})`;
  statements.push(
    env.DB.prepare(
      `INSERT OR IGNORE INTO training_projection_state(account_id,source_revision,built_at) SELECT ?,-1,? WHERE ${currentGuard}`,
    ).bind(accountId, now, accountId, revision),
  );
  const workouts: Record<string, unknown>[] = [];
  const allSets: Record<string, unknown>[] = [];
  const visibility: Record<string, unknown>[] = [];
  if (restore)
    statements.push(
      env.DB.prepare(
        `UPDATE workout_visibility SET visibility='private',decision_revision=decision_revision+1,updated_at=? WHERE account_id=? AND visibility<>'private' AND ${currentGuard}`,
      ).bind(now, accountId, accountId, revision),
    );
  else
    statements.push(
      env.DB.prepare(
        `UPDATE workout_visibility SET visibility='private',decision_revision=decision_revision+1,updated_at=? WHERE account_id=? AND visibility<>'private' AND workout_id NOT IN (SELECT value FROM json_each(?)) AND ${currentGuard}`,
      ).bind(now, accountId, JSON.stringify([...validIds]), accountId, revision),
    );
  statements.push(
    env.DB.prepare(
      `DELETE FROM training_workouts WHERE account_id=? AND workout_id NOT IN (SELECT value FROM json_each(?)) AND ${currentGuard}`,
    ).bind(accountId, JSON.stringify([...validIds]), accountId, revision),
  );
  for (const w of valid) {
    const old = existing.get(w.id),
      captured = w as typeof w & { trainingDate?: string; trainingTimezone?: string };
    const timezone =
      captured.trainingTimezone || old?.trainingTimezone || profile?.trainingTimezone || 'UTC';
    const completed =
      w.completedAt ||
      w.exercises
        .flatMap((ex) =>
          ex.actualSets.map((set) => set.completedAt).filter((x): x is string => !!x),
        )
        .sort()
        .at(-1) ||
      w.updatedAt;
    const date =
      captured.trainingDate ||
      (old?.completedAt === completed ? old.trainingDate : trainingDate(completed, timezone));
    if (
      !old ||
      old.startedAt !== w.startedAt ||
      old.completedAt !== completed ||
      old.trainingDate !== date ||
      old.trainingTimezone !== timezone
    )
      workouts.push({
        workoutId: w.id,
        startedAt: w.startedAt,
        completedAt: completed,
        trainingDate: date,
        trainingTimezone: timezone,
        sourceRevision: revision,
      });
    const workoutSets = w.exercises.flatMap((ex) =>
      ex.actualSets
        .filter((set) => set.status === 'completed')
        .map((set) => ({
          workoutId: w.id,
          id: set.id,
          instanceId: ex.id,
          exerciseId: ex.exerciseId,
          loadMode: set.loadMode,
          weight: set.weight,
          reps: set.reps,
          kind: set.kind,
          completedAt: set.completedAt || w.completedAt || w.updatedAt,
        })),
    );
    for (const set of workoutSets) {
      const key = setKey(set),
        previous = existingSets.get(key);
      existingSets.delete(key);
      if (!previous || Object.entries(set).some(([field, value]) => previous[field] !== value))
        allSets.push(set);
    }
    const explicit = (
      w as typeof w & {
        communityVisibility?: { visibility: 'private' | 'community'; policyRevision: number };
      }
    ).communityVisibility;
    const shouldAuto =
      !restore &&
      !!settings?.autoPublishWorkouts &&
      !!settings?.audienceAcknowledgedAt &&
      !!settings?.enabledAt &&
      Date.parse(w.startedAt) >= Date.parse(settings.enabledAt);
    const requested =
      explicit?.visibility === 'private'
        ? 'private'
        : explicit?.policyRevision === settings?.policyRevision &&
            explicit?.visibility === 'community'
          ? 'community'
          : undefined;
    const desired: 'private' | 'community' = restore
      ? 'private'
      : (requested ?? (shouldAuto ? 'community' : 'private'));
    visibility.push({
      accountId,
      workoutId: w.id,
      visibility: desired,
      policyRevision: settings?.policyRevision ?? 0,
      updatedAt: now,
    });
  }
  const insertChunks = (rows: Record<string, unknown>[], size: number, sql: string) => {
    for (let offset = 0; offset < rows.length; offset += size) {
      statements.push(
        env.DB.prepare(sql).bind(
          accountId,
          JSON.stringify(rows.slice(offset, offset + size)),
          accountId,
          revision,
        ),
      );
    }
  };
  // Deleting a workout cascades its sets. For retained workouts delete only
  // removed set identities, including sets corrected back to incomplete.
  insertChunks(
    [...existingSets.values()].filter((set) => validIds.has(String(set.workoutId))),
    500,
    `DELETE FROM training_sets WHERE account_id=? AND (workout_id,exercise_instance_id,set_id) IN (SELECT json_extract(value,'$.workoutId'),json_extract(value,'$.instanceId'),json_extract(value,'$.id') FROM json_each(?)) AND ${currentGuard}`,
  );
  insertChunks(
    workouts,
    100,
    `INSERT INTO training_workouts(account_id,workout_id,started_at,completed_at,training_date,training_timezone,source_revision) SELECT ?,json_extract(value,'$.workoutId'),json_extract(value,'$.startedAt'),json_extract(value,'$.completedAt'),json_extract(value,'$.trainingDate'),json_extract(value,'$.trainingTimezone'),json_extract(value,'$.sourceRevision') FROM json_each(?) WHERE ${currentGuard} ON CONFLICT(account_id,workout_id) DO UPDATE SET started_at=excluded.started_at,completed_at=excluded.completed_at,training_date=excluded.training_date,training_timezone=excluded.training_timezone,source_revision=excluded.source_revision`,
  );
  insertChunks(
    allSets,
    500,
    `INSERT INTO training_sets(account_id,workout_id,set_id,exercise_instance_id,exercise_id,load_mode,weight_lb,reps,kind,completed_at) SELECT ?,json_extract(value,'$.workoutId'),json_extract(value,'$.id'),json_extract(value,'$.instanceId'),json_extract(value,'$.exerciseId'),json_extract(value,'$.loadMode'),json_extract(value,'$.weight'),json_extract(value,'$.reps'),json_extract(value,'$.kind'),json_extract(value,'$.completedAt') FROM json_each(?) WHERE ${currentGuard} ON CONFLICT(account_id,workout_id,exercise_instance_id,set_id) DO UPDATE SET exercise_id=excluded.exercise_id,load_mode=excluded.load_mode,weight_lb=excluded.weight_lb,reps=excluded.reps,kind=excluded.kind,completed_at=excluded.completed_at`,
  );
  insertChunks(
    visibility,
    100,
    `INSERT OR IGNORE INTO workout_visibility(account_id,workout_id,visibility,decision_revision,updated_at) SELECT ?,json_extract(value,'$.workoutId'),CASE WHEN json_extract(value,'$.visibility')='community' AND EXISTS(SELECT 1 FROM sharing_settings s WHERE s.account_id=json_extract(value,'$.accountId') AND s.policy_revision=json_extract(value,'$.policyRevision')) THEN 'community' ELSE 'private' END,0,json_extract(value,'$.updatedAt') FROM json_each(?) WHERE ${currentGuard}`,
  );
  const markComplete = [
    env.DB.prepare(
      `INSERT INTO training_projection_state(account_id,source_revision,built_at) SELECT ?,?,? WHERE ${currentGuard} ON CONFLICT(account_id) DO UPDATE SET source_revision=excluded.source_revision,built_at=excluded.built_at WHERE excluded.source_revision>=training_projection_state.source_revision`,
    ).bind(accountId, revision, now, accountId, revision),
  ];
  const final: ReturnType<Env['DB']['prepare']>[] = [];
  if (restore)
    final.push(
      env.DB.prepare(
        `UPDATE sharing_settings SET summary_enabled=0,auto_publish_workouts=0,workout_sharing_enabled_at=NULL,audience_acknowledged_at=NULL,policy_revision=policy_revision+1,updated_at=? WHERE account_id=? AND ${currentGuard}`,
      ).bind(now, accountId, accountId, revision),
    );
  else {
    // A previously shared workout can be explicitly corrected after sync. If
    // that correction removes every completed working set, withdraw its public
    // visibility before retaining (or creating) a publication row.
    final.push(
      env.DB.prepare(
        "UPDATE workout_visibility SET visibility='private',decision_revision=decision_revision+1,updated_at=? WHERE account_id=? AND visibility='community' AND NOT EXISTS(SELECT 1 FROM training_sets ts WHERE ts.account_id=workout_visibility.account_id AND ts.workout_id=workout_visibility.workout_id AND ts.kind='working') AND " +
          currentGuard,
      ).bind(now, accountId, accountId, revision),
    );
    final.push(
      env.DB.prepare(
        `INSERT INTO workout_publications(account_id,workout_id,id,activity_at,published_at,shared_title) SELECT tw.account_id,tw.workout_id,lower(hex(randomblob(16))),tw.completed_at,?,COALESCE((SELECT json_extract(value,'$.title') FROM json_each(?) WHERE json_extract(value,'$.workoutId')=tw.workout_id),'Workout') FROM training_workouts tw JOIN workout_visibility v USING(account_id,workout_id) JOIN account_state ast ON ast.account_id=tw.account_id WHERE tw.account_id=? AND v.visibility='community' AND ast.revision=? AND COALESCE((SELECT source_revision FROM training_projection_state WHERE account_id=tw.account_id),-1)=${baseline} AND EXISTS(SELECT 1 FROM training_sets ts WHERE ts.account_id=tw.account_id AND ts.workout_id=tw.workout_id AND ts.kind='working') ON CONFLICT(account_id,workout_id) DO UPDATE SET shared_title=excluded.shared_title WHERE workout_publications.shared_title IS NOT excluded.shared_title`,
      ).bind(
        now,
        JSON.stringify(valid.map((workout) => ({ workoutId: workout.id, title: workout.name }))),
        accountId,
        revision,
      ),
    );
  }
  await env.DB.batch([...statements, ...final, ...markComplete]);
  const completedProjection = await env.DB.prepare(
    'SELECT source_revision sourceRevision FROM training_projection_state WHERE account_id=?',
  )
    .bind(accountId)
    .first<{ sourceRevision: number }>();
  if (completedProjection?.sourceRevision !== revision) {
    const current = await env.DB.prepare('SELECT revision FROM account_state WHERE account_id=?')
      .bind(accountId)
      .first<{ revision: number }>();
    if (current?.revision === revision) {
      if (attempt >= 2) throw new Error('Projection changed concurrently. Retry synchronization.');
      await rebuildProjection(env, accountId, revision, data, restore, attempt + 1);
    }
  }
}
app.get('/api/session', async (c) => c.json(await getSession(c.env, c.get('accountId'))));
app.patch('/api/me/profile', async (c) => {
  const body = z
    .object({
      displayName: z.string().trim().min(1).max(60),
      trainingTimezone: z.string().min(1).max(80),
    })
    .parse(await c.req.json());
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: body.trainingTimezone });
  } catch {
    return c.json({ error: 'Invalid training timezone.' }, 400);
  }
  const now = new Date().toISOString(),
    accountId = c.get('accountId');
  await c.env.DB.batch([
    // Apply the setup default once, after the audience notice. Later profile edits,
    // retries and accounts with an existing sharing choice cannot reset that choice.
    c.env.DB.prepare(
      'UPDATE sharing_settings SET auto_publish_workouts=1,workout_sharing_enabled_at=?,audience_acknowledged_at=?,policy_revision=policy_revision+1,updated_at=? WHERE account_id=? AND policy_revision=1 AND EXISTS(SELECT 1 FROM profiles WHERE account_id=? AND setup_completed_at IS NULL)',
    ).bind(now, now, now, accountId, accountId),
    c.env.DB.prepare(
      'UPDATE profiles SET display_name=?,training_timezone=?,updated_at=?,setup_completed_at=COALESCE(setup_completed_at,?) WHERE account_id=?',
    ).bind(body.displayName, body.trainingTimezone, now, now, accountId),
  ]);
  return c.json(await getSession(c.env, c.get('accountId')));
});
app.patch('/api/me/sharing', async (c) => {
  const body = z
    .object({
      summaryEnabled: z.boolean(),
      autoPublishWorkouts: z.boolean(),
      policyRevision: z.number().int().min(1),
      audienceAcknowledged: z.boolean().default(false),
    })
    .parse(await c.req.json());
  const accountId = c.get('accountId'),
    previous = await c.env.DB.prepare(
      'SELECT policy_revision policyRevision,summary_enabled summaryEnabled,auto_publish_workouts autoPublishWorkouts FROM sharing_settings WHERE account_id=?',
    )
      .bind(accountId)
      .first<{ policyRevision: number; summaryEnabled: number; autoPublishWorkouts: number }>();
  if (!previous || body.policyRevision !== previous.policyRevision)
    return c.json({ error: 'Sharing settings changed. Refresh and review again.' }, 409);
  if (
    ((body.summaryEnabled && !previous.summaryEnabled) ||
      (body.autoPublishWorkouts && !previous.autoPublishWorkouts)) &&
    !body.audienceAcknowledged
  )
    return c.json({ error: 'Review the community audience before enabling sharing.' }, 400);
  const now = new Date().toISOString();
  const changed = await c.env.DB.prepare(
    'UPDATE sharing_settings SET summary_enabled=?,auto_publish_workouts=?,workout_sharing_enabled_at=CASE WHEN ?=1 THEN COALESCE(workout_sharing_enabled_at,?) ELSE NULL END,audience_acknowledged_at=CASE WHEN ?=1 THEN ? ELSE audience_acknowledged_at END,policy_revision=policy_revision+1,updated_at=? WHERE account_id=? AND policy_revision=?',
  )
    .bind(
      Number(body.summaryEnabled),
      Number(body.autoPublishWorkouts),
      Number(body.autoPublishWorkouts),
      now,
      Number(body.audienceAcknowledged),
      now,
      now,
      accountId,
      body.policyRevision,
    )
    .run();
  if (!changed.meta.changes)
    return c.json({ error: 'Sharing settings changed. Refresh and review again.' }, 409);
  return c.json(await getSession(c.env, accountId));
});
async function mutualBlock(env: Env, viewer: string, owner: string) {
  return !!(await env.DB.prepare(
    'SELECT 1 FROM account_blocks WHERE (account_id=? AND blocked_account_id=?) OR (account_id=? AND blocked_account_id=?)',
  )
    .bind(viewer, owner, owner, viewer)
    .first());
}
async function profileDto(env: Env, accountId: string) {
  return env.DB.prepare(
    'SELECT public_id publicId,display_name displayName,training_timezone trainingTimezone FROM profiles WHERE account_id=?',
  )
    .bind(accountId)
    .first<{ publicId: string; displayName: string; trainingTimezone: string }>();
}
function exerciseLabel(id: string) {
  return catalog.find((e) => e.id === id)?.name || 'Custom exercise';
}
async function accountPersonalRecords(env: Env, accountId: string) {
  return statePersonalRecords(await readState(env, accountId));
}
function statePersonalRecords(state: Awaited<ReturnType<typeof readState>>) {
  return {
    ...personalRecordsFromWorkouts(state.data.workouts, state.data.exercises),
    revision: state.revision,
    workoutNames: new Map(state.data.workouts.map((workout) => [workout.id, workout.name])),
    workoutExerciseNames: new Map(
      state.data.workouts.map((workout) => [
        workout.id,
        new Map(workout.exercises.map((exercise) => [exercise.id, exercise.name])),
      ]),
    ),
  };
}
async function feedPersonalRecords(env: Env, accountIds: string[]) {
  const records = new Map<string, ReturnType<typeof statePersonalRecords>>();
  if (!accountIds.length) return records;
  // Two coherent bulk reads instead of three queries for each feed author.
  // This cache lives only for this request; authorization stays fresh on every read.
  const ids = JSON.stringify(accountIds);
  const [metadata, contents] = await env.DB.batch([
    env.DB.prepare(
      'SELECT account_id accountId,payload,revision FROM account_state WHERE account_id IN (SELECT value FROM json_each(?))',
    ).bind(ids),
    env.DB.prepare(
      'SELECT account_id accountId,content FROM state_chunks WHERE account_id IN (SELECT value FROM json_each(?)) ORDER BY account_id,chunk_index',
    ).bind(ids),
  ]);
  const chunks = new Map<string, string[]>();
  for (const row of contents.results as { accountId: string; content: string }[]) {
    if (!chunks.has(row.accountId)) chunks.set(row.accountId, []);
    chunks.get(row.accountId)!.push(row.content);
  }
  for (const row of metadata.results as {
    accountId: string;
    payload: string;
    revision: number;
  }[]) {
    records.set(
      row.accountId,
      statePersonalRecords({
        data: validateBackup(JSON.parse(chunks.get(row.accountId)?.join('') || row.payload)),
        revision: row.revision,
      }),
    );
  }
  return records;
}
async function feedItems(
  env: Env,
  viewer: string,
  owner?: string,
  before?: { activityAt: string; id: string },
) {
  const pageSize = owner ? 5 : 20;
  const rows = await env.DB.prepare(
    `SELECT p.id,p.account_id accountId,p.workout_id workoutId,p.shared_title sharedTitle,p.activity_at activityAt,pr.public_id publicId,pr.display_name displayName,pr.training_timezone trainingTimezone,tw.training_date trainingDate,tw.started_at startedAt,tw.completed_at completedAt,ps.source_revision sourceRevision FROM workout_publications p JOIN training_workouts tw USING(account_id,workout_id) JOIN training_projection_state ps ON ps.account_id=p.account_id AND ps.source_revision>=tw.source_revision JOIN account_state ast ON ast.account_id=p.account_id AND ast.revision=ps.source_revision JOIN workout_visibility v USING(account_id,workout_id) JOIN sharing_settings s ON s.account_id=p.account_id JOIN accounts a ON a.id=p.account_id AND a.status='active' JOIN profiles pr ON pr.account_id=p.account_id WHERE v.visibility='community' AND (? IS NULL OR p.account_id=?) AND (? IS NULL OR (p.activity_at,p.id)<(?,?)) AND NOT EXISTS(SELECT 1 FROM account_blocks b WHERE (b.account_id=? AND b.blocked_account_id=p.account_id) OR (b.account_id=p.account_id AND b.blocked_account_id=?)) ORDER BY p.activity_at DESC,p.id DESC LIMIT ?`,
  )
    .bind(
      owner ?? null,
      owner ?? null,
      before?.activityAt ?? null,
      before?.activityAt ?? null,
      before?.id ?? null,
      viewer,
      viewer,
      pageSize + 1,
    )
    .all<Record<string, any>>();
  const items = [];
  const page = rows.results.slice(0, pageSize);
  const recordsByAccount = await feedPersonalRecords(env, [
    ...new Set(page.map((row) => row.accountId as string)),
  ]);
  const sets = page.length
    ? await env.DB.prepare(
        "SELECT ts.account_id accountId,ts.workout_id workoutId,ts.exercise_instance_id exerciseInstanceId,ts.exercise_id exerciseId,ts.kind FROM training_sets ts JOIN training_projection_state ps ON ps.account_id=ts.account_id JOIN account_state ast ON ast.account_id=ts.account_id AND ast.revision=ps.source_revision WHERE (ts.account_id,ts.workout_id) IN (SELECT json_extract(value,'$.accountId'),json_extract(value,'$.workoutId') FROM json_each(?)) ORDER BY ts.account_id,ts.workout_id,ts.exercise_instance_id",
      )
        .bind(
          JSON.stringify(
            page.map((row) => ({ accountId: row.accountId, workoutId: row.workoutId })),
          ),
        )
        .all<{
          accountId: string;
          workoutId: string;
          exerciseInstanceId: string;
          exerciseId: string;
          kind: string;
        }>()
    : { results: [] };
  type FeedSet = (typeof sets.results)[number];
  const setsByWorkout = new Map<string, FeedSet[]>();
  for (const set of sets.results) {
    const key = JSON.stringify([set.accountId, set.workoutId]);
    if (!setsByWorkout.has(key)) setsByWorkout.set(key, []);
    setsByWorkout.get(key)!.push(set);
  }
  for (const row of page) {
    const workoutSets = setsByWorkout.get(JSON.stringify([row.accountId, row.workoutId])) || [];
    const workingSets = workoutSets.filter((set) => set.kind === 'working');
    const personalRecords = recordsByAccount.get(row.accountId);
    if (!workingSets.length || !personalRecords) continue;
    const names = [
      ...new Map(workingSets.map((set) => [set.exerciseInstanceId, set])).values(),
    ].slice(0, 2);
    items.push({
      id: row.id,
      profile: {
        publicId: row.publicId,
        displayName: row.displayName,
        trainingTimezone: row.trainingTimezone,
      },
      activityAt: row.activityAt,
      title:
        row.sharedTitle ||
        (personalRecords.revision === row.sourceRevision
          ? personalRecords.workoutNames.get(row.workoutId)
          : undefined) ||
        'Workout',
      durationMinutes: Math.max(
        0,
        Math.round((Date.parse(row.completedAt) - Date.parse(row.startedAt)) / 60000),
      ),
      exerciseCount: new Set(workoutSets.map((set) => set.exerciseInstanceId)).size,
      setCount: workingSets.length,
      exerciseNames: names.map(
        (x) =>
          (personalRecords.revision === row.sourceRevision
            ? personalRecords.workoutExerciseNames.get(row.workoutId)?.get(x.exerciseInstanceId)
            : undefined) || exerciseLabel(x.exerciseId),
      ),
      hasRecord:
        personalRecords.revision === row.sourceRevision &&
        personalRecords.achievements.some((record) => record.workoutId === row.workoutId),
    });
  }
  const last = rows.results[Math.min(pageSize - 1, rows.results.length - 1)];
  return {
    items,
    nextCursor:
      rows.results.length > pageSize && last
        ? btoa(JSON.stringify([last.activityAt, last.id]))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/g, '')
        : null,
  };
}
app.get('/api/community/feed', async (c) => {
  const cursor = c.req.query('cursor');
  let before: { activityAt: string; id: string } | undefined;
  if (cursor) {
    try {
      const base64 = cursor.replace(/-/g, '+').replace(/_/g, '/');
      const parsed = JSON.parse(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4)));
      if (Array.isArray(parsed) && typeof parsed[0] === 'string' && typeof parsed[1] === 'string')
        before = { activityAt: parsed[0], id: parsed[1] };
      else return c.json({ error: 'Invalid cursor.' }, 400);
    } catch {
      return c.json({ error: 'Invalid cursor.' }, 400);
    }
  }
  return c.json(await feedItems(c.env, c.get('accountId'), undefined, before));
});
app.get('/api/community/people', async (c) => {
  const q = (c.req.query('q') || '').trim().slice(0, 60),
    viewer = c.get('accountId');
  const people = await c.env.DB.prepare(
    "SELECT p.public_id publicId,p.display_name displayName,p.training_timezone trainingTimezone,p.account_id accountId FROM profiles p JOIN accounts a ON a.id=p.account_id AND a.status='active' WHERE p.account_id<>? AND p.display_name LIKE ? AND NOT EXISTS(SELECT 1 FROM account_blocks b WHERE (b.account_id=? AND b.blocked_account_id=p.account_id) OR (b.account_id=p.account_id AND b.blocked_account_id=?)) ORDER BY p.display_name LIMIT 50",
  )
    .bind(viewer, `%${q}%`, viewer, viewer)
    .all<Record<string, any>>();
  return c.json({
    items: people.results.map((p) => ({
      publicId: p.publicId,
      displayName: p.displayName,
      trainingTimezone: p.trainingTimezone,
    })),
  });
});
app.get('/api/community/profiles/:publicId', async (c) => {
  const profile = await c.env.DB.prepare(
    'SELECT account_id accountId,public_id publicId,display_name displayName,training_timezone trainingTimezone FROM profiles WHERE public_id=?',
  )
    .bind(c.req.param('publicId'))
    .first<Record<string, any>>();
  if (!profile || (await mutualBlock(c.env, c.get('accountId'), profile.accountId)))
    return c.json({ error: 'Profile unavailable.' }, 404);
  const session = await getSession(c.env, profile.accountId).catch(() => null);
  if (!session) return c.json({ error: 'Profile unavailable.' }, 404);
  const stateRevision = await c.env.DB.prepare(
    'SELECT revision FROM account_state WHERE account_id=?',
  )
    .bind(profile.accountId)
    .first<{ revision: number }>();
  const projectedRevision = await c.env.DB.prepare(
    'SELECT source_revision sourceRevision FROM training_projection_state WHERE account_id=?',
  )
    .bind(profile.accountId)
    .first<{ sourceRevision: number }>();
  if (stateRevision && projectedRevision?.sourceRevision !== stateRevision.revision) {
    const current = await readState(c.env, profile.accountId);
    await rebuildProjection(c.env, profile.accountId, current.revision, current.data, false);
  }
  const owner = profile.accountId === c.get('accountId'),
    scope = owner || session.sharing.summaryEnabled ? 'all-history' : 'shared-workouts';
  const page = await feedItems(c.env, c.get('accountId'), profile.accountId);
  const sharedOnly = scope === 'shared-workouts';
  const visibility = sharedOnly
    ? ` JOIN workout_publications pub USING(account_id,workout_id) JOIN workout_visibility vis USING(account_id,workout_id) JOIN accounts ownerAccount ON ownerAccount.id=tw.account_id AND ownerAccount.status='active' `
    : '';
  const permitted = sharedOnly
    ? ` AND vis.visibility='community' AND NOT EXISTS(SELECT 1 FROM account_blocks b WHERE (b.account_id=? AND b.blocked_account_id=tw.account_id) OR (b.account_id=tw.account_id AND b.blocked_account_id=?))`
    : '';
  const base = `FROM training_sets ts JOIN training_workouts tw USING(account_id,workout_id) JOIN training_projection_state ps ON ps.account_id=tw.account_id AND ps.source_revision>=tw.source_revision JOIN account_state ast ON ast.account_id=tw.account_id AND ast.revision=ps.source_revision${visibility} WHERE ts.account_id=? AND ts.kind='working'${permitted}`;
  const params = sharedOnly
    ? [profile.accountId, c.get('accountId'), c.get('accountId')]
    : [profile.accountId];
  const weeks = await c.env.DB.prepare(
    `SELECT date(tw.training_date,'-'||((strftime('%w',tw.training_date)+6)%7)||' days') startDate,COUNT(*) sets ${base} GROUP BY startDate ORDER BY startDate DESC LIMIT 52`,
  )
    .bind(...params)
    .all<{ startDate: string; sets: number }>();
  const records = await c.env.DB.prepare(
    `SELECT exerciseId,loadMode,weight,reps,date FROM (SELECT ts.exercise_id exerciseId,ts.load_mode loadMode,ts.weight_lb weight,ts.reps,ts.completed_at date,ROW_NUMBER() OVER(PARTITION BY ts.exercise_id,ts.load_mode,ts.reps ORDER BY CASE WHEN ts.load_mode='assistance' THEN -ts.weight_lb ELSE ts.weight_lb END DESC,ts.completed_at DESC) rank ${base}) WHERE rank=1 ORDER BY exerciseId,reps`,
  )
    .bind(...params)
    .all<Record<string, any>>();
  const trends = await c.env.DB.prepare(
    `WITH ranked_sets AS (SELECT ts.exercise_id exerciseId,ts.load_mode loadMode,ts.weight_lb weight,ts.reps,tw.started_at date,tw.workout_id workoutId,ROW_NUMBER() OVER(PARTITION BY tw.workout_id,ts.exercise_id,ts.load_mode ORDER BY CASE WHEN ts.load_mode='assistance' THEN -ts.weight_lb ELSE ts.weight_lb END DESC,ts.reps DESC,ts.completed_at DESC) setRank ${base}), sessions AS (SELECT *,ROW_NUMBER() OVER(PARTITION BY exerciseId,loadMode ORDER BY date DESC,workoutId DESC) sessionRank FROM ranked_sets WHERE setRank=1) SELECT exerciseId,loadMode,weight,reps,date FROM sessions WHERE sessionRank<=8 ORDER BY date,workoutId`,
  )
    .bind(...params)
    .all<{ exerciseId: string; loadMode: LoadMode; weight: number; reps: number; date: string }>();
  const exerciseStats = new Map<string, ExerciseStat>();
  const bestByExercise = new Map(
    (owner || session.sharing.summaryEnabled
      ? (await accountPersonalRecords(c.env, profile.accountId)).best
      : []
    ).map((record) => [recordKey(record.exerciseId, record.loadMode), record]),
  );
  for (const point of trends.results) {
    const key = `${point.exerciseId}|${point.loadMode}`;
    const stat: ExerciseStat = exerciseStats.get(key) ?? {
      exerciseId: point.exerciseId,
      name: exerciseLabel(point.exerciseId),
      loadMode: point.loadMode,
      points: [],
    };
    stat.points.push({ date: point.date, weight: point.weight, reps: point.reps });
    const best = bestByExercise.get(recordKey(point.exerciseId, point.loadMode));
    if (best) stat.personalBest = { weight: best.weight, reps: best.reps, date: best.date };
    exerciseStats.set(key, stat);
  }
  return c.json({
    profile: {
      publicId: profile.publicId,
      displayName: profile.displayName,
      trainingTimezone: profile.trainingTimezone,
    },
    scope,
    statsVisible: owner || session.sharing.summaryEnabled,
    weeks: owner || session.sharing.summaryEnabled ? weeks.results : [],
    records:
      owner || session.sharing.summaryEnabled
        ? records.results.map((r) => ({ ...r, name: exerciseLabel(r.exerciseId) }))
        : [],
    workouts: page.items,
    nextWorkoutCursor: page.nextCursor,
    exerciseStats: owner || session.sharing.summaryEnabled ? [...exerciseStats.values()] : [],
  });
});
app.get('/api/community/profiles/:publicId/workouts', async (c) => {
  const target = await c.env.DB.prepare(
    "SELECT p.account_id accountId FROM profiles p JOIN accounts a ON a.id=p.account_id AND a.status='active' WHERE p.public_id=?",
  )
    .bind(c.req.param('publicId'))
    .first<{ accountId: string }>();
  if (!target || (await mutualBlock(c.env, c.get('accountId'), target.accountId)))
    return c.json({ error: 'Profile unavailable.' }, 404);
  let before: { activityAt: string; id: string } | undefined;
  const cursor = c.req.query('cursor');
  if (cursor)
    try {
      const base64 = cursor.replace(/-/g, '+').replace(/_/g, '/');
      const value = JSON.parse(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4)));
      if (!Array.isArray(value) || typeof value[0] !== 'string' || typeof value[1] !== 'string')
        throw new Error();
      before = { activityAt: value[0], id: value[1] };
    } catch {
      return c.json({ error: 'Invalid cursor.' }, 400);
    }
  return c.json(await feedItems(c.env, c.get('accountId'), target.accountId, before));
});
app.get('/api/community/workouts/:publicationId', async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT p.account_id accountId,p.workout_id workoutId,p.shared_title sharedTitle,p.activity_at activityAt,pr.public_id publicId,pr.display_name displayName,pr.training_timezone trainingTimezone,tw.started_at startedAt,tw.completed_at completedAt,ps.source_revision sourceRevision FROM workout_publications p JOIN workout_visibility v USING(account_id,workout_id) JOIN training_workouts tw USING(account_id,workout_id) JOIN training_projection_state ps ON ps.account_id=tw.account_id AND ps.source_revision>=tw.source_revision JOIN account_state ast ON ast.account_id=p.account_id AND ast.revision=ps.source_revision JOIN accounts a ON a.id=p.account_id AND a.status='active' JOIN profiles pr ON pr.account_id=p.account_id WHERE p.id=? AND v.visibility='community'",
  )
    .bind(c.req.param('publicationId'))
    .first<Record<string, any>>();
  if (!row || (await mutualBlock(c.env, c.get('accountId'), row.accountId)))
    return c.json({ error: 'Workout unavailable.' }, 404);
  const sets = await c.env.DB.prepare(
    'SELECT ts.set_id setId,ts.exercise_instance_id exerciseInstanceId,ts.exercise_id exerciseId,ts.load_mode loadMode,ts.weight_lb weight,ts.reps,ts.kind FROM training_sets ts JOIN training_projection_state ps ON ps.account_id=ts.account_id JOIN account_state ast ON ast.account_id=ts.account_id AND ast.revision=ps.source_revision JOIN training_workouts tw ON tw.account_id=ts.account_id AND tw.workout_id=ts.workout_id AND tw.source_revision<=ps.source_revision WHERE ts.account_id=? AND ts.workout_id=? ORDER BY ts.exercise_instance_id,ts.completed_at',
  )
    .bind(row.accountId, row.workoutId)
    .all<Record<string, any>>();
  const personalRecords = await accountPersonalRecords(c.env, row.accountId);
  const exerciseNames =
    personalRecords.revision === row.sourceRevision
      ? personalRecords.workoutExerciseNames.get(row.workoutId)
      : undefined;
  const groups = new Map<string, any>();
  for (const s of sets.results) {
    const k = s.exerciseInstanceId;
    if (!groups.has(k))
      groups.set(k, {
        id: k,
        exerciseId: s.exerciseId,
        name: exerciseNames?.get(k) || exerciseLabel(s.exerciseId),
        loadMode: s.loadMode,
        sets: [],
      });
    groups.get(k).sets.push({
      id: s.setId,
      weight: s.weight,
      reps: s.reps,
      kind: s.kind,
      loadMode: s.loadMode,
    });
  }
  const recordSetIds =
    personalRecords.revision === row.sourceRevision
      ? personalRecords.achievements
          .filter(
            (record) =>
              record.workoutId === row.workoutId &&
              sets.results.some(
                (set) =>
                  set.setId === record.setId &&
                  Math.abs(set.weight - record.weight) < 0.000001 &&
                  set.reps === record.reps,
              ),
          )
          .map((record) => record.setId)
      : [];
  return c.json({
    id: c.req.param('publicationId'),
    recordSetIds,
    profile: {
      publicId: row.publicId,
      displayName: row.displayName,
      trainingTimezone: row.trainingTimezone,
    },
    title:
      row.sharedTitle ||
      (personalRecords.revision === row.sourceRevision
        ? personalRecords.workoutNames.get(row.workoutId)
        : undefined) ||
      'Workout',
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    exercises: [...groups.values()],
  });
});
app.get('/api/me/workouts/:workoutId/visibility', async (c) => {
  const a = c.get('accountId'),
    id = c.req.param('workoutId'),
    row = await c.env.DB.prepare(
      'SELECT visibility,decision_revision decisionRevision FROM workout_visibility WHERE account_id=? AND workout_id=?',
    )
      .bind(a, id)
      .first<{ visibility: 'private' | 'community'; decisionRevision: number }>();
  if (!row) return c.json({ visibility: 'private', decisionRevision: 0 });
  return c.json(row);
});
app.put('/api/me/workouts/:workoutId/visibility', async (c) => {
  const body = z
    .object({
      visibility: z.enum(['private', 'community']),
      decisionRevision: z.number().int().min(0),
      policyRevision: z.number().int().min(1),
      audienceAcknowledged: z.boolean().optional(),
    })
    .parse(await c.req.json());
  const a = c.get('accountId'),
    id = c.req.param('workoutId'),
    now = new Date().toISOString();
  if (body.visibility === 'community' && !body.audienceAcknowledged)
    return c.json({ error: 'Community audience acknowledgement is required.' }, 400);
  const count = await c.env.DB.prepare(
    "SELECT COUNT(*) count FROM training_sets ts JOIN training_workouts tw USING(account_id,workout_id) JOIN training_projection_state ps ON ps.account_id=tw.account_id AND ps.source_revision>=tw.source_revision JOIN account_state ast ON ast.account_id=tw.account_id AND ast.revision=ps.source_revision WHERE ts.account_id=? AND ts.workout_id=? AND ts.kind='working'",
  )
    .bind(a, id)
    .first<{ count: number }>();
  if (body.visibility === 'community' && !count?.count)
    return c.json(
      { error: 'Only a current, finished workout with completed working sets can be shared.' },
      409,
    );
  const decision = body.decisionRevision + 1;
  const updated = await c.env.DB.prepare(
    'INSERT INTO workout_visibility(account_id,workout_id,visibility,decision_revision,updated_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM sharing_settings WHERE account_id=? AND policy_revision=?) ON CONFLICT(account_id,workout_id) DO UPDATE SET visibility=excluded.visibility,decision_revision=excluded.decision_revision,updated_at=excluded.updated_at WHERE workout_visibility.decision_revision=?',
  )
    .bind(a, id, body.visibility, decision, now, a, body.policyRevision, body.decisionRevision)
    .run();
  if (!updated.meta.changes)
    return c.json({ error: 'Workout visibility changed. Refresh and review again.' }, 409);
  if (body.visibility === 'community') {
    const state = await readState(c.env, a);
    const title = state.data.workouts.find((workout) => workout.id === id)?.name || 'Workout';
    await c.env.DB.prepare(
      "INSERT INTO workout_publications(account_id,workout_id,id,activity_at,published_at,shared_title) SELECT tw.account_id,tw.workout_id,?,tw.completed_at,?,? FROM training_workouts tw JOIN training_projection_state ps ON ps.account_id=tw.account_id AND ps.source_revision>=tw.source_revision JOIN account_state ast ON ast.account_id=tw.account_id AND ast.revision=ps.source_revision JOIN workout_visibility v USING(account_id,workout_id) WHERE tw.account_id=? AND tw.workout_id=? AND v.visibility='community' AND v.decision_revision=? AND EXISTS(SELECT 1 FROM training_sets ts WHERE ts.account_id=tw.account_id AND ts.workout_id=tw.workout_id AND ts.kind='working') ON CONFLICT(account_id,workout_id) DO UPDATE SET shared_title=excluded.shared_title WHERE workout_publications.shared_title IS NOT excluded.shared_title",
    )
      .bind(crypto.randomUUID(), now, title, a, id, decision)
      .run();
  }
  return c.json({ visibility: body.visibility, decisionRevision: decision });
});
app.post('/api/me/hide-workouts', async (c) => {
  const a = c.get('accountId'),
    now = new Date().toISOString();
  await c.env.DB.prepare(
    "UPDATE workout_visibility SET visibility='private',decision_revision=decision_revision+1,updated_at=? WHERE account_id=?",
  )
    .bind(now, a)
    .run();
  return c.body(null, 204);
});
app.post('/api/community/profiles/:publicId/block', async (c) => {
  const target = await c.env.DB.prepare(
    'SELECT account_id accountId FROM profiles WHERE public_id=?',
  )
    .bind(c.req.param('publicId'))
    .first<{ accountId: string }>();
  if (!target || target.accountId === c.get('accountId'))
    return c.json({ error: 'Profile unavailable.' }, 404);
  await c.env.DB.prepare('INSERT OR IGNORE INTO account_blocks VALUES (?,?,?)')
    .bind(c.get('accountId'), target.accountId, new Date().toISOString())
    .run();
  return c.body(null, 204);
});
app.delete('/api/community/profiles/:publicId/block', async (c) => {
  await c.env.DB.prepare(
    'DELETE FROM account_blocks WHERE account_id=? AND blocked_account_id=(SELECT account_id FROM profiles WHERE public_id=?)',
  )
    .bind(c.get('accountId'), c.req.param('publicId'))
    .run();
  return c.body(null, 204);
});
app.get('/api/state', async (c) => c.json(await readState(c.env, c.get('accountId'))));
app.get('/api/providers', (c) => c.json(c.get('coachEnabled') ? providers(c.env) : []));
app.put('/api/state', async (c) => {
  const request = z
    .object({
      operationId: z.string().min(1).max(100),
      deviceId: z.string().min(1).max(100),
      baseRevision: z.number().int().min(0),
      accountId: z.string().optional(),
      restore: z.boolean().optional(),
      data: z.unknown(),
      legacyData: z.unknown().optional(),
    })
    .parse(await c.req.json());
  const data = validateBackup(request.data);
  const futureLimit = Date.now() + 5 * 60_000;
  for (const workout of data.workouts) {
    const started = Date.parse(workout.startedAt),
      completed = workout.completedAt ? Date.parse(workout.completedAt) : undefined;
    if (
      !Number.isFinite(started) ||
      started > futureLimit ||
      (completed !== undefined &&
        (!Number.isFinite(completed) || completed > futureLimit || completed < started))
    )
      return c.json({ error: 'Workout timestamps are invalid or in the future.' }, 400);
  }
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(
      JSON.stringify({
        data,
        deviceId: request.deviceId,
        baseRevision: request.baseRevision,
        accountId: request.accountId,
        restore: request.restore,
      }),
    ),
  );
  const fingerprint = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  const accountId = c.get('accountId');
  const loopbackDev =
    c.env.LOCAL_DEV === 'true' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(new URL(c.req.url).hostname);
  if (!request.accountId && !loopbackDev)
    return c.json({ error: 'Account identity is required for synchronization.' }, 409);
  if (request.accountId && request.accountId !== accountId)
    return c.json(
      { error: 'Account identity changed. Refresh your session before synchronizing.' },
      409,
    );
  const previous = await c.env.DB.prepare(
    'SELECT revision, fingerprint FROM sync_receipts WHERE account_id = ? AND operation_id = ?',
  )
    .bind(accountId, request.operationId)
    .first<{ revision: number; fingerprint: string }>();
  if (previous) {
    let replayMatches = previous.fingerprint === fingerprint;
    const rawLegacyData =
      request.legacyData ??
      (request.data &&
      typeof request.data === 'object' &&
      (request.data as { schemaVersion?: unknown }).schemaVersion === 1
        ? request.data
        : undefined);
    let legacyPayloadMatches = false;
    if (
      rawLegacyData &&
      typeof rawLegacyData === 'object' &&
      (rawLegacyData as { schemaVersion?: unknown }).schemaVersion === 1
    ) {
      try {
        legacyPayloadMatches =
          JSON.stringify(validateBackup(rawLegacyData)) === JSON.stringify(data);
      } catch {
        /* invalid legacy payload cannot authenticate a receipt replay */
      }
    }
    if (!replayMatches && rawLegacyData !== undefined && legacyPayloadMatches) {
      const legacyDigest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(
          JSON.stringify({
            data: rawLegacyData,
            deviceId: request.deviceId,
            baseRevision: request.baseRevision,
            accountId: request.accountId,
            restore: request.restore,
          }),
        ),
      );
      replayMatches =
        [...new Uint8Array(legacyDigest)]
          .map((byte) => byte.toString(16).padStart(2, '0'))
          .join('') === previous.fingerprint;
    }
    if (replayMatches) {
      const current = await c.env.DB.prepare(
        'SELECT revision FROM account_state WHERE account_id=?',
      )
        .bind(accountId)
        .first<{ revision: number }>();
      if (current?.revision === previous.revision)
        await rebuildProjection(c.env, accountId, previous.revision, data, !!request.restore);
      return c.json({ revision: previous.revision });
    } else
      return c.json({ error: 'An operation identifier was reused for different content.' }, 400);
  }
  const incomingVersion =
    request.data && typeof request.data === 'object'
      ? (request.data as { schemaVersion?: unknown }).schemaVersion
      : undefined;
  const rawSaved = await readRawState(c.env, accountId);
  const storedVersion = (rawSaved?.data as { schemaVersion?: unknown } | null)?.schemaVersion;
  const currentVersion = typeof storedVersion === 'number' ? storedVersion : 0;
  if (currentVersion > 1 && incomingVersion === 1)
    return c.json(
      {
        error:
          'This account has newer training data. Upgrade this app before syncing so your pending changes are preserved.',
        code: 'client_upgrade_required',
        currentSchemaVersion: currentVersion,
      },
      426,
    );
  // Validate/migrate only after the raw persisted version guard, so a newer
  // unsupported server schema produces a clear upgrade response without writes.
  const saved = rawSaved
    ? { data: validateBackup(rawSaved.data), revision: rawSaved.revision }
    : await readState(c.env, accountId);
  // Active sessions, routines, preferences and chat are not finished training.
  // Compare validated snapshots before touching any training projection rows.
  const trainingUnchanged =
    !request.restore &&
    saved.revision === request.baseRevision &&
    JSON.stringify(saved.data.workouts.filter((workout) => workout.status === 'finished')) ===
      JSON.stringify(data.workouts.filter((workout) => workout.status === 'finished'));
  const now = new Date().toISOString();
  const chunks = splitState(JSON.stringify(data));
  // The receipt check above is only a fast path. A competing request may commit
  // this operation before our batch starts, so enforce immutability in SQL too.
  const unreceiptedOperation =
    'NOT EXISTS (SELECT 1 FROM sync_receipts WHERE account_id=account_state.account_id AND operation_id=account_state.last_operation_id)';
  await c.env.DB.batch([
    c.env.DB.prepare(
      'UPDATE account_state SET payload = ?, revision = revision + 1, updated_at = ?, device_id = ?, last_operation_id = ? WHERE account_id = ? AND revision = ? AND NOT EXISTS (SELECT 1 FROM sync_receipts WHERE account_id=account_state.account_id AND operation_id=?)',
    ).bind(
      '',
      now,
      request.deviceId,
      request.operationId,
      accountId,
      request.baseRevision,
      request.operationId,
    ),
    c.env.DB.prepare(
      `DELETE FROM state_chunks WHERE account_id = ? AND chunk_index >= ? AND EXISTS (SELECT 1 FROM account_state WHERE account_id = ? AND last_operation_id = ? AND ${unreceiptedOperation})`,
    ).bind(accountId, chunks.length, accountId, request.operationId),
    ...chunks.map((content, index) =>
      c.env.DB.prepare(
        `INSERT INTO state_chunks (account_id, chunk_index, content) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM account_state WHERE account_id = ? AND last_operation_id = ? AND ${unreceiptedOperation}) ON CONFLICT(account_id,chunk_index) DO UPDATE SET content=excluded.content WHERE state_chunks.content IS NOT excluded.content`,
      ).bind(accountId, index, content, accountId, request.operationId),
    ),
    c.env.DB.prepare(
      'INSERT OR IGNORE INTO sync_receipts (account_id, operation_id, revision, created_at, fingerprint) SELECT ?, ?, revision, ?, ? FROM account_state WHERE account_id = ? AND last_operation_id = ?',
    ).bind(accountId, request.operationId, now, fingerprint, accountId, request.operationId),
  ]);
  const receipt = await c.env.DB.prepare(
    'SELECT revision, fingerprint FROM sync_receipts WHERE account_id = ? AND operation_id = ?',
  )
    .bind(accountId, request.operationId)
    .first<{ revision: number; fingerprint: string }>();
  if (!receipt) return c.json(await readState(c.env, accountId), 409);
  if (receipt.fingerprint !== fingerprint)
    return c.json({ error: 'An operation identifier was reused for different content.' }, 400);
  if (trainingUnchanged) {
    // Certify the existing projection for the new account revision. Keeping
    // this guard exact preserves fail-closed reads if an earlier build failed
    // or another request advanced the account while this sync was in flight.
    const advanced = await c.env.DB.prepare(
      'UPDATE training_projection_state SET source_revision=?,built_at=? WHERE account_id=? AND source_revision=? AND EXISTS(SELECT 1 FROM account_state WHERE account_id=? AND revision=?)',
    )
      .bind(receipt.revision, now, accountId, request.baseRevision, accountId, receipt.revision)
      .run();
    if (advanced.meta.changes) return c.json({ revision: receipt.revision });
  }
  await rebuildProjection(c.env, accountId, receipt.revision, data, !!request.restore);
  return c.json({ revision: receipt.revision });
});
app.get('/api/export', async (c) => c.json((await readState(c.env, c.get('accountId'))).data));
app.delete('/api/state', async (c) => {
  const accountId = c.get('accountId'),
    now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM state_chunks WHERE account_id = ?').bind(accountId),
    c.env.DB.prepare('DELETE FROM sync_receipts WHERE account_id = ?').bind(accountId),
    c.env.DB.prepare('DELETE FROM coach_requests WHERE account_id = ?').bind(accountId),
    c.env.DB.prepare('DELETE FROM training_projection_state WHERE account_id=?').bind(accountId),
    c.env.DB.prepare(
      "UPDATE workout_visibility SET visibility='private',decision_revision=decision_revision+1,updated_at=? WHERE account_id=?",
    ).bind(now, accountId),
    c.env.DB.prepare(
      'UPDATE sharing_settings SET summary_enabled=0,auto_publish_workouts=0,workout_sharing_enabled_at=NULL,audience_acknowledged_at=NULL,policy_revision=policy_revision+1,updated_at=? WHERE account_id=?',
    ).bind(now, accountId),
    c.env.DB.prepare('DELETE FROM account_state WHERE account_id = ?').bind(accountId),
  ]);
  return c.body(null, 204);
});
app.post('/api/import', (c) =>
  c.json(
    { error: 'Import must use the confirmed, revision-checked local restore flow and /api/state.' },
    409,
  ),
);
app.post('/api/coach/chat', async (c) => {
  if (!c.get('coachEnabled'))
    return c.json({ error: 'Coach is not enabled for this account.' }, 403);
  const accountId = c.get('accountId');
  const request = z
    .object({
      message: z.string().trim().min(1).max(4000),
      provider: z.enum(['openai', 'anthropic']),
      model: z.string().trim().max(100).optional(),
      context: z
        .object({
          routineId: z.string().optional(),
          workoutId: z.string().optional(),
          exerciseId: z.string().optional(),
        })
        .optional(),
    })
    .parse(await c.req.json());
  const now = new Date().toISOString(),
    cutoff = new Date(Date.now() - 60_000).toISOString();
  const count = await c.env.DB.prepare(
    'SELECT COUNT(*) AS count FROM coach_requests WHERE account_id = ? AND created_at > ?',
  )
    .bind(accountId, cutoff)
    .first<{ count: number }>();
  if ((count?.count || 0) >= 8)
    return c.json({ error: 'Coach is receiving many requests. Try again in a minute.' }, 429);
  await c.env.DB.prepare('INSERT INTO coach_requests (account_id, id, created_at) VALUES (?, ?, ?)')
    .bind(accountId, crypto.randomUUID(), now)
    .run();
  await c.env.DB.prepare('DELETE FROM coach_requests WHERE account_id = ? AND created_at < ?')
    .bind(accountId, new Date(Date.now() - 86_400_000).toISOString())
    .run();
  const { data } = await readState(c.env, accountId);
  return c.json(await coachReply(c.env, data, request));
});
app.notFound((c) => c.json({ error: 'Unknown API endpoint.' }, 404));
app.onError((error, c) => {
  if (error instanceof CoachError)
    return c.json({ error: error.message, code: error.code }, error.status);
  if (
    error instanceof z.ZodError ||
    error instanceof SyntaxError ||
    error.name === 'ValidationError' ||
    error.message.startsWith('Invalid backup:')
  )
    return c.json({ error: 'Invalid request data.', details: error.message }, 400);
  console.error('Request failed', error.name);
  return c.json(
    {
      error: error.message.startsWith('Choose a provisioned')
        ? error.message
        : 'Request could not be completed. Your local workout data is safe.',
    },
    503,
  );
});
export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx);
  },
};
