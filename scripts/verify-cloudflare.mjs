import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { safeCoachDiagnostic } from './diagnose-cloudflare.mjs';

export function localOrigin(value) {
  const url = new URL(value);
  assert(
    url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname),
    'local_origin_required',
  );
  assert(
    !url.username && !url.password && !url.search && !url.hash && url.pathname === '/',
    'local_origin_required',
  );
  return url.origin;
}

export function verifyRoutineReply(reply) {
  const draft = reply?.proposals?.find(
    (proposal) => proposal.scope === 'routine' && proposal.routineDraft,
  )?.routineDraft;
  assert(
    draft && typeof draft.id === 'string' && draft.id && draft.exercises?.length === 3,
    'routine_draft_missing',
  );
  const expected = ['ex_pull-up', 'ex_dumbbell-bench', 'ex_dumbbell-shoulder-press'];
  for (const [index, exercise] of draft.exercises.entries()) {
    assert(exercise.exerciseId === expected[index], 'exercise_mismatch');
    assert(
      exercise.sets === 3 && JSON.stringify(exercise.repRange) === '[3,3]',
      'prescription_mismatch',
    );
    assert(exercise.targetWeight === (index === 0 ? 0 : 50), 'load_mismatch');
    assert(
      exercise.loadMode === (index === 0 ? 'bodyweight' : 'per-dumbbell'),
      'load_mode_mismatch',
    );
  }
  assert(
    reply.proposals.every((proposal) => proposal.status === 'pending'),
    'unreviewed_change_applied',
  );
  return {
    exercises: 3,
    setsPerExercise: 3,
    repsPerSet: 3,
    bodyweightAddedLoad: 0,
    poundsPerDumbbell: 50,
  };
}

export async function verifyLiveCoach(origin, fetcher = fetch) {
  origin = localOrigin(origin);
  const get = async (path) => {
    const response = await fetcher(`${origin}${path}`, {
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    assert(response.ok, 'local_api_failed');
    return response.json();
  };
  const providers = await get('/api/providers');
  const selected = providers.find(
    (provider) => ['openai', 'anthropic'].includes(provider.id) && provider.models?.length,
  );
  assert(selected, 'local_provider_required');
  const session = await get('/api/session');
  const before = await get('/api/state');
  const response = await fetcher(`${origin}/api/coach/chat`, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(100_000),
    headers: { 'Content-Type': 'application/json', 'X-Lifts-Account': session.accountId },
    body: JSON.stringify({
      provider: selected.id,
      model: selected.models[0],
      message:
        'Help me create a routine with three exercises pull-ups the dumbbell bench press and dumbbell shoulder press each three sets three reps pull-ups is bodyweight and the others are 50 pound dumbbells',
    }),
  });
  const reply = await response.json();
  if (!response.ok) {
    return {
      status: 'failed',
      httpStatus: response.status,
      ...safeCoachDiagnostic(reply),
      // App codes are fixed identifiers, never provider error strings.
      appCode: [
        'provider_credentials',
        'provider_rate_limit',
        'coach_generation_failed',
        'provider_selection',
      ].includes(reply.code)
        ? reply.code
        : 'request_failed',
    };
  }
  const prescription = verifyRoutineReply(reply);
  const after = await get('/api/state');
  assert.deepEqual(after.data, before.data, 'coach_mutated_training_state');
  return { status: 'passed', ...prescription, trainingStateUnchanged: true };
}

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function providerVars() {
  const paths = process.env.LOCAL_COACH_VARS_FILE
    ? [process.env.LOCAL_COACH_VARS_FILE]
    : ['output/coach-local/.dev.vars', '.dev.vars'];
  for (const path of paths) {
    try {
      const vars = parseEnv(await readFile(path, 'utf8'));
      if (vars.OPENAI_API_KEY?.trim() || vars.ANTHROPIC_API_KEY?.trim()) {
        return Object.fromEntries(
          ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_MODELS', 'ANTHROPIC_MODELS']
            .filter((key) => vars[key])
            .map((key) => [key, vars[key]]),
        );
      }
    } catch {
      /* Missing files are a readiness result, never an excuse to retrieve production secrets. */
    }
  }
  return null;
}

async function run() {
  const live = process.argv.includes('--live-coach');
  const serve = process.argv.includes('--serve');
  const vars = live || serve ? await providerVars() : null;
  if (live && !vars) return { core: 'not_run', liveCoach: { status: 'local_provider_required' } };
  await mkdir('output', { recursive: true });
  const directory = await mkdtemp(resolve('output/cloudflare-verify-'));
  const config = resolve(directory, 'wrangler.json');
  const state = serve ? resolve('output/local-app/state') : resolve(directory, 'state');
  const verifyId = randomUUID();
  await writeFile(
    config,
    JSON.stringify({
      name: 'lifts-coach-local-verification',
      main: resolve('worker/localDev.ts'),
      compatibility_date: '2026-10-13',
      assets: {
        directory: resolve('dist'),
        binding: 'ASSETS',
        not_found_handling: 'single-page-application',
        run_worker_first: ['/api/*', '/__local_ready'],
      },
      d1_databases: [
        {
          binding: 'DB',
          database_name: 'verification',
          database_id: '00000000-0000-4000-8000-000000000001',
          migrations_dir: resolve('migrations'),
        },
      ],
      vars: { LOCAL_DEV: 'true', LOCAL_VERIFY_ID: verifyId },
    }),
  );
  if (vars) {
    try {
      await writeFile(
        resolve(directory, '.dev.vars'),
        Object.entries(vars)
          .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
          .join('\n'),
        { mode: 0o600 },
      );
    } catch {
      await unlink(resolve(directory, '.dev.vars')).catch(() => {});
      throw new Error('local_secret_configuration_failed');
    }
  }
  const children = new Set();
  const stopRequested = new AbortController();
  let spawnFailed = false;
  const start = (args, extraEnv = {}) => {
    assert(!stopRequested.signal.aborted, 'local_interrupted');
    // Only fixed commands and local paths; no shell interpolation or secret arguments.
    const child = spawn('pnpm', args, {
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...extraEnv, WRANGLER_SEND_METRICS: 'false' },
    });
    // Drain but never print raw Wrangler output: it can include binding/account metadata.
    child.stdout.resume();
    child.stderr.resume();
    child.on('error', () => {
      spawnFailed = true;
    });
    children.add(child);
    return child;
  };
  const stopping = new WeakMap();
  const stop = (child) => {
    if (!stopping.has(child)) stopping.set(child, stopChild(child));
    return stopping.get(child);
  };
  const stopChild = async (child) => {
    if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
    const exited = once(child, 'exit').catch(() => {});
    try {
      process.platform === 'win32' ? child.kill() : process.kill(-child.pid, 'SIGTERM');
    } catch {}
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2000))]);
    if (child.exitCode === null && child.signalCode === null) {
      try {
        process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL');
      } catch {}
    }
  };
  const command = async (args, code, extraEnv = {}) => {
    const child = start(args, extraEnv);
    const timeout = setTimeout(() => {
      void stop(child);
    }, 45_000);
    try {
      const [exit] = await once(child, 'exit');
      assert(exit === 0, code);
    } finally {
      clearTimeout(timeout);
    }
  };
  const signalHandler = (signal) => {
    stopRequested.abort();
    process.exitCode = signal === 'SIGINT' ? 130 : 143;
    for (const child of children) void stop(child);
  };
  const sigterm = () => signalHandler('SIGTERM');
  const sigint = () => signalHandler('SIGINT');
  process.once('SIGTERM', sigterm);
  process.once('SIGINT', sigint);
  try {
    await command(
      [
        'exec',
        'wrangler',
        'd1',
        'migrations',
        'apply',
        'verification',
        '--local',
        '--config',
        config,
        '--persist-to',
        state,
      ],
      'local_migration_failed',
    );
    const port = await freePort();
    let inspector = await freePort();
    while (inspector === port) inspector = await freePort();
    assert(!stopRequested.signal.aborted, 'local_interrupted');
    const worker = start([
      'exec',
      'wrangler',
      'dev',
      '--local',
      '--config',
      config,
      '--persist-to',
      state,
      '--ip',
      '127.0.0.1',
      '--port',
      String(port),
      '--inspector-port',
      String(inspector),
    ]);
    const origin = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let attempt = 0; attempt < 80 && worker.exitCode === null; attempt++) {
      assert(!spawnFailed, 'local_process_start_failed');
      assert(!stopRequested.signal.aborted, 'local_interrupted');
      try {
        const response = await fetch(`${origin}/__local_ready`, {
          headers: { 'X-Local-Verify': verifyId },
          redirect: 'error',
          signal: AbortSignal.any([stopRequested.signal, AbortSignal.timeout(500)]),
        });
        ready = response.ok && (await response.json()).ready === true;
      } catch {}
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert(ready, 'local_worker_start_failed');
    if (serve) {
      console.log(`Local app: ${origin}`);
      console.log(
        `Data: output/local-app/state (local only). Coach: ${vars ? 'local provider configured' : 'unavailable until a local provider key is configured'}.`,
      );
      console.log(
        'Press Ctrl+C to stop. Rebuild after frontend changes; Worker source reloads automatically.',
      );
      await Promise.race([
        once(worker, 'exit'),
        new Promise((resolve) =>
          stopRequested.signal.addEventListener('abort', resolve, { once: true }),
        ),
      ]);
      assert(stopRequested.signal.aborted, 'local_worker_exited');
      return { server: 'stopped' };
    }
    // This fixture writes only to the fresh local database. Never import a user's backup.
    await command(['exec', 'node', 'scripts/test-worker.mjs'], 'local_api_verification_failed', {
      TEST_WORKER_ORIGIN: origin,
    });
    return {
      core: 'passed',
      liveCoach: live ? await verifyLiveCoach(origin) : { status: 'not_run' },
    };
  } finally {
    for (const child of children) await stop(child);
    process.removeListener('SIGTERM', sigterm);
    process.removeListener('SIGINT', sigint);
    // Remove only the temporary copied provider secret, never recurse over state/user paths.
    if (vars) {
      await unlink(resolve(directory, '.dev.vars')).catch(() => {});
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await run().catch((error) => {
    const reasons = new Set([
      'local_migration_failed',
      'local_worker_start_failed',
      'local_api_verification_failed',
      'local_api_failed',
      'routine_draft_missing',
      'exercise_mismatch',
      'prescription_mismatch',
      'load_mismatch',
      'load_mode_mismatch',
      'unreviewed_change_applied',
      'coach_mutated_training_state',
      'local_provider_required',
      'local_interrupted',
      'local_process_start_failed',
      'local_worker_exited',
      'local_secret_configuration_failed',
    ]);
    return {
      core: 'failed',
      reason: reasons.has(error.message) ? error.message : 'verification_failed',
      liveCoach: { status: 'not_verified' },
    };
  });
  if (process.argv.includes('--serve')) {
    if (report.server !== 'stopped') {
      console.error(JSON.stringify(report));
      process.exitCode ||= 1;
    }
  } else {
    await mkdir('output', { recursive: true });
    await writeFile(
      'output/cloudflare-verification.json',
      JSON.stringify({ ...report, checkedAt: new Date().toISOString() }, null, 2),
    );
    console.log(JSON.stringify(report, null, 2));
    if (
      report.core !== 'passed' ||
      (process.argv.includes('--live-coach') && report.liveCoach.status !== 'passed')
    )
      process.exitCode ||= 1;
  }
}
