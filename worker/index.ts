/// <reference types="@cloudflare/workers-types" />
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { drizzle } from 'drizzle-orm/d1';
import { z } from 'zod';
import { accountState } from './schema';
import { authorize } from './auth';
import { coachReply, providers } from './coach';
import type { ProviderEnv } from './coach';
import { emptyData, validateBackup } from '../shared/domain';
import { splitState } from './chunks';

interface Env extends ProviderEnv {
  DB: D1Database;
  ASSETS: Fetcher;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  LOCAL_DEV?: string;
}
const app = new Hono<{ Bindings: Env }>();
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
  if (!(await authorize(c.req.raw, c.env)))
    return c.json({ error: 'Cloudflare Access authentication is required.' }, 401);
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
async function readState(env: Env) {
  const db = drizzle(env.DB);
  await db
    .insert(accountState)
    .values({
      id: 'personal',
      payload: JSON.stringify(emptyData()),
      revision: 0,
      updatedAt: new Date().toISOString(),
      deviceId: '',
    })
    .onConflictDoNothing();
  // D1 batches execute transactionally: metadata and chunks must describe the
  // same revision even when another device is writing concurrently.
  const [metadata, contents] = await env.DB.batch([
    env.DB.prepare('SELECT payload, revision FROM account_state WHERE id = ?').bind('personal'),
    env.DB.prepare('SELECT content FROM state_chunks ORDER BY chunk_index'),
  ]);
  const row = metadata.results[0] as { payload: string; revision: number };
  const chunks = contents.results as { content: string }[];
  return {
    data: validateBackup(
      JSON.parse(chunks.length ? chunks.map((chunk) => chunk.content).join('') : row.payload),
    ),
    revision: row.revision,
  };
}
app.get('/api/state', async (c) => c.json(await readState(c.env)));
app.get('/api/providers', (c) => c.json(providers(c.env)));
app.put('/api/state', async (c) => {
  const request = z
    .object({
      operationId: z.string().min(1).max(100),
      deviceId: z.string().min(1).max(100),
      baseRevision: z.number().int().min(0),
      data: z.unknown(),
    })
    .parse(await c.req.json());
  const data = validateBackup(request.data);
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(
      JSON.stringify({ data, deviceId: request.deviceId, baseRevision: request.baseRevision }),
    ),
  );
  const fingerprint = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  await readState(c.env);
  const previous = await c.env.DB.prepare(
    'SELECT revision, fingerprint FROM sync_receipts WHERE operation_id = ?',
  )
    .bind(request.operationId)
    .first<{ revision: number; fingerprint: string }>();
  if (previous)
    return previous.fingerprint === fingerprint
      ? c.json({ revision: previous.revision })
      : c.json({ error: 'An operation identifier was reused for different content.' }, 400);
  const now = new Date().toISOString();
  const chunks = splitState(JSON.stringify(data));
  await c.env.DB.batch([
    c.env.DB.prepare(
      'UPDATE account_state SET payload = ?, revision = revision + 1, updated_at = ?, device_id = ?, last_operation_id = ? WHERE id = ? AND revision = ?',
    ).bind('', now, request.deviceId, request.operationId, 'personal', request.baseRevision),
    c.env.DB.prepare(
      'DELETE FROM state_chunks WHERE EXISTS (SELECT 1 FROM account_state WHERE id = ? AND last_operation_id = ?)',
    ).bind('personal', request.operationId),
    ...chunks.map((content, index) =>
      c.env.DB.prepare(
        'INSERT INTO state_chunks (chunk_index, content) SELECT ?, ? WHERE EXISTS (SELECT 1 FROM account_state WHERE id = ? AND last_operation_id = ?)',
      ).bind(index, content, 'personal', request.operationId),
    ),
    c.env.DB.prepare(
      'INSERT OR IGNORE INTO sync_receipts (operation_id, revision, created_at, fingerprint) SELECT ?, revision, ?, ? FROM account_state WHERE id = ? AND last_operation_id = ?',
    ).bind(request.operationId, now, fingerprint, 'personal', request.operationId),
  ]);
  const receipt = await c.env.DB.prepare(
    'SELECT revision, fingerprint FROM sync_receipts WHERE operation_id = ?',
  )
    .bind(request.operationId)
    .first<{ revision: number; fingerprint: string }>();
  if (!receipt) return c.json(await readState(c.env), 409);
  if (receipt.fingerprint !== fingerprint)
    return c.json({ error: 'An operation identifier was reused for different content.' }, 400);
  return c.json({ revision: receipt.revision });
});
app.get('/api/export', async (c) => c.json((await readState(c.env)).data));
app.post('/api/import', (c) =>
  c.json(
    { error: 'Import must use the confirmed, revision-checked local restore flow and /api/state.' },
    409,
  ),
);
app.post('/api/coach/chat', async (c) => {
  const request = z
    .object({
      message: z.string().trim().min(1).max(4000),
      provider: z.enum(['openai', 'anthropic']),
      model: z.string().min(1).max(100),
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
    'SELECT COUNT(*) AS count FROM coach_requests WHERE created_at > ?',
  )
    .bind(cutoff)
    .first<{ count: number }>();
  if ((count?.count || 0) >= 8)
    return c.json({ error: 'Coach is receiving many requests. Try again in a minute.' }, 429);
  await c.env.DB.prepare('INSERT INTO coach_requests (id, created_at) VALUES (?, ?)')
    .bind(crypto.randomUUID(), now)
    .run();
  await c.env.DB.prepare('DELETE FROM coach_requests WHERE created_at < ?')
    .bind(new Date(Date.now() - 86_400_000).toISOString())
    .run();
  const { data } = await readState(c.env);
  return c.json(await coachReply(c.env, data, request));
});
app.notFound((c) => c.json({ error: 'Unknown API endpoint.' }, 404));
app.onError((error, c) => {
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
