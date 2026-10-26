import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, writeFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import {
  cloudflareIdentity,
  deploymentFingerprint,
  diagnosticFromSource,
  safeProbeReport,
} from './diagnose-cloudflare.mjs';

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

let cleanupCurrent = async () => {};
let interrupted = false;
let interruptedExitCode;
const abortController = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    interrupted = true;
    interruptedExitCode = signal === 'SIGINT' ? 130 : 143;
    abortController.abort();
    void cleanupCurrent().finally(() => {
      process.exitCode = interruptedExitCode;
    });
  });
}

async function main() {
  const baseline = process.argv.includes('--baseline');
  const deployedBaseline = process.argv.includes('--deployed-baseline');
  if (baseline && deployedBaseline) throw new Error('choose_one_baseline');
  const deployed = JSON.parse(await readFile('wrangler.deploy.json', 'utf8'));
  if (!/^[a-zA-Z0-9_-]{1,63}$/.test(deployed.name)) throw new Error('configuration');
  try {
    process.loadEnvFile('.env.deploy.local');
  } catch {
    /* Use the existing Wrangler login. */
  }
  const identity = await cloudflareIdentity(process.env, deployed);
  const before = await deploymentFingerprint(identity);
  await mkdir('output', { recursive: true });
  const directory = await mkdtemp(resolve('output/cloudflare-probe-'));
  let child;
  let secretsFile;
  let cleanupPromise = Promise.resolve();
  const cleanup = () => {
    cleanupPromise = cleanupPromise.then(async () => {
      if (child && child.exitCode === null && child.signalCode === null && child.pid) {
        const done = once(child, 'exit').catch(() => {});
        try {
          if (process.platform === 'win32') {
            spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
          } else {
            process.kill(-child.pid, 'SIGTERM');
          }
        } catch {}
        await Promise.race([done, new Promise((resolve) => setTimeout(resolve, 2000))]);
        if (child.exitCode === null && child.signalCode === null) {
          try {
            if (process.platform === 'win32') {
              spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
            } else process.kill(-child.pid, 'SIGKILL');
          } catch {}
        }
      }
      if (secretsFile) await unlink(secretsFile).catch(() => {});
    });
    return cleanupPromise;
  };
  cleanupCurrent = cleanup;
  const nonce = randomUUID();
  secretsFile = resolve(directory, '.dev.vars');
  // The only locally stored secret is this short-lived probe guard, never the model key.
  const config = {
    name: deployed.name,
    main: resolve('worker/coachProbe.ts'),
    compatibility_date: '2026-10-13',
  };
  if (deployedBaseline) {
    // Read static deployed code only, never D1 state or secret values. Reuse its
    // actual Coach functions in the isolated probe rather than assuming HEAD is live.
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${identity.accountId}/workers/scripts/${deployed.name}/content/v2`,
      {
        headers: { Authorization: `Bearer ${identity.token}` },
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok) throw new Error('deployed_baseline_unavailable');
    const form = await response.formData();
    const candidates = [];
    for (const value of form.values()) {
      if (typeof value !== 'string' && /\.m?js$/.test(value.name || '')) {
        const source = await value.text();
        if (
          /async function coachReply\(/.test(source) &&
          /function providers\(/.test(source) &&
          /class CoachError|CoachError = class/.test(source)
        )
          candidates.push(source);
      }
    }
    if (candidates.length !== 1) throw new Error('deployed_baseline_unavailable');
    const originalSource = candidates[0];
    const functionStart = originalSource.indexOf('async function coachReply(');
    const functionEnd = originalSource.indexOf('async function generateCoachReply(', functionStart);
    const handler = originalSource.slice(functionStart, functionEnd);
    const instrumented = handler.replace(
      /catch \((\w+)\) \{/,
      (match, variable) =>
        `${match}\n globalThis[Symbol.for("lifts.coach.probe.failure")] = ${variable};`,
    );
    if (functionStart < 0 || functionEnd < 0 || handler === instrumented)
      throw new Error('deployed_baseline_unavailable');
    const syntheticSource =
      originalSource.slice(0, functionStart) + instrumented + originalSource.slice(functionEnd);
    const path = resolve(directory, 'deployed-coach.mjs');
    await writeFile(path, `${syntheticSource}\nexport { coachReply, CoachError, providers };\n`);
    config.alias = { './coach': path };
  }
  if (baseline) {
    const original = spawnSync('git', ['show', 'HEAD:worker/coach.ts'], {
      encoding: 'utf8',
      maxBuffer: 1_000_000,
    });
    if (original.status !== 0) throw new Error('baseline_unavailable');
    const source = original.stdout.replace(
      /from '(\.[^']+)'/g,
      (_match, specifier) => `from '${resolve('worker', specifier).replaceAll('\\', '/')}'`,
    );
    const path = resolve(directory, 'coach-baseline.ts');
    await writeFile(path, source);
    config.alias = { './coach': path };
  }
  const configPath = resolve(directory, 'wrangler.json');
  await writeFile(configPath, JSON.stringify(config));
  await writeFile(secretsFile, `DIAGNOSTIC_NONCE=${JSON.stringify(nonce)}\n`, { mode: 0o600 });
  const port = await freePort();
  let inspector = await freePort();
  while (inspector === port) inspector = await freePort();
  if (interrupted) throw new Error('preview_interrupted');
  // No await may occur between this guard and spawn: signal handlers cannot
  // interleave within this synchronous section.
  child = spawn(
    'pnpm',
    [
      'exec',
      'wrangler',
      'dev',
      '--remote',
      '--config',
      configPath,
      '--ip',
      '127.0.0.1',
      '--port',
      String(port),
      '--inspector-port',
      String(inspector),
    ],
    {
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    },
  );
  let pending = '';
  const diagnostics = [];
  const capture = (chunk) => {
    pending += chunk.toString();
    if (pending.length > 100_000) pending = pending.slice(-50_000);
    // Wrangler may render structured logs over multiple lines. Extract only complete
    // JSON objects that have our fixed event name; never print its raw stdout/stderr.
    const lines = pending.split('\n');
    pending = lines.pop();
    for (const line of lines) {
      const start = line.indexOf('{');
      if (start >= 0) {
        try {
          const event = JSON.parse(line.slice(start));
          if (event.message === 'Coach request failed')
            diagnostics.push(diagnosticFromSource(event));
        } catch {}
      }
    }
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  let spawnError = false;
  child.once('error', () => {
    spawnError = true;
  });
  let report;
  try {
    if (interrupted) throw new Error('preview_interrupted');
    const origin = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let attempt = 0; attempt < 120 && child.exitCode === null; attempt++) {
      if (interrupted) throw new Error('preview_interrupted');
      if (spawnError) throw new Error('preview_spawn_failed');
      try {
        ready = (
          await fetch(`${origin}/__health`, {
            headers: { 'X-Diagnostic-Nonce': nonce },
            redirect: 'error',
            signal: AbortSignal.any([abortController.signal, AbortSignal.timeout(1000)]),
          })
        ).ok;
      } catch {}
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (spawnError || child.pid === undefined) throw new Error('preview_spawn_failed');
    if (interrupted) throw new Error('preview_interrupted');
    if (!ready) {
      report = { status: 'remote_preview_unavailable' };
    } else {
      const response = await fetch(`${origin}/__coach_verify`, {
        method: 'POST',
        headers: { 'X-Diagnostic-Nonce': nonce },
        redirect: 'error',
        signal: AbortSignal.any([abortController.signal, AbortSignal.timeout(110_000)]),
      });
      const result = await response.json();
      // Closed response fields from our probe, no provider response text.
      report = safeProbeReport(result, response.status);
      if (result.diagnostic) diagnostics.push(diagnosticFromSource(result.diagnostic));
    }
  } finally {
    await cleanup();
    cleanupCurrent = async () => {};
  }
  const output = {
    revision: deployedBaseline ? 'deployed' : baseline ? 'HEAD' : 'working_tree',
    ...report,
    diagnostics,
    productionTrainingDataAccessed: false,
    productionDeploymentUnchanged: before === (await deploymentFingerprint(identity)),
  };
  await writeFile(
    `output/cloudflare-remote-${deployedBaseline ? 'deployed' : baseline ? 'baseline' : 'current'}.json`,
    JSON.stringify(output, null, 2),
  );
  console.log(JSON.stringify(output, null, 2));
  if (report.status !== 'passed' || !output.productionDeploymentUnchanged) process.exitCode = 1;
}

main().catch(async (error) => {
  await cleanupCurrent();
  if (interrupted) {
    process.exitCode = interruptedExitCode;
    return;
  }
  const reasons = [
    'configuration',
    'choose_one_baseline',
    'authentication_required',
    'account_selection_required',
    'account_configuration_required',
    'deployment_verification_unavailable',
    'deployed_baseline_unavailable',
    'baseline_unavailable',
    'preview_spawn_failed',
    'preview_interrupted',
  ];
  console.error(
    JSON.stringify({
      status: 'remote_verification_failed',
      reason: reasons.includes(error.message) ? error.message : 'preview_transport_or_tool_failure',
    }),
  );
  process.exitCode = 1;
});
