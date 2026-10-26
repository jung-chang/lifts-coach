import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const stages = new Set([
  'provider_request',
  'provider_output',
  'proposal_validation',
  'proposal_simulation',
]);
const names = new Set([
  'Error',
  'TypeError',
  'AbortError',
  'TimeoutError',
  'ZodError',
  'AI_APICallError',
  'AI_NoObjectGeneratedError',
  'AI_TypeValidationError',
  'AI_RetryError',
]);
const codes = new Set([
  'invalid_json_schema',
  'invalid_api_key',
  'insufficient_quota',
  'rate_limit_exceeded',
  'model_not_found',
  'invalid_request_error',
  'context_length_exceeded',
  'server_error',
  'overloaded_error',
]);

// Closed projection: never return arbitrary log text, exception messages, source
// keys, URLs, headers, account identifiers or provider bodies.
export function safeCoachDiagnostic(source) {
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch {
      return {};
    }
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
  const safe = {};
  if (stages.has(source.stage)) safe.stage = source.stage;
  if (names.has(source.name)) safe.name = source.name;
  if (codes.has(source.code)) safe.code = source.code;
  if (Number.isInteger(source.status) && source.status >= 100 && source.status <= 599)
    safe.status = source.status;
  if (
    typeof source.diagnosticId === 'string' &&
    /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(source.diagnosticId)
  )
    safe.diagnosticId = source.diagnosticId;
  if (source.code === 'invalid_json_schema') safe.schemaRejected = true;
  return safe;
}

export function diagnosticFromSource(source) {
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch {
      return {};
    }
  }
  let legacy = {};
  if (typeof source?.message === 'string' && source.message.startsWith('Coach request failed {')) {
    try {
      legacy = JSON.parse(source.message.slice('Coach request failed '.length));
    } catch {}
  }
  return {
    ...safeCoachDiagnostic(source),
    ...safeCoachDiagnostic(source?.diagnostic),
    ...safeCoachDiagnostic(legacy),
  };
}

export function safeProbeReport(result, httpStatus) {
  if (
    result?.status === 'passed' &&
    httpStatus === 200 &&
    result.exercises === 3 &&
    result.setsPerExercise === 3 &&
    result.repsPerSet === 3 &&
    result.poundsPerDumbbell === 50 &&
    result.approvalVerified === true &&
    result.workoutSnapshotVerified === true
  ) {
    return {
      status: 'passed',
      httpStatus: 200,
      exercises: 3,
      setsPerExercise: 3,
      repsPerSet: 3,
      poundsPerDumbbell: 50,
      approvalVerified: true,
      workoutSnapshotVerified: true,
    };
  }
  const safe = {
    status: result?.status === 'provider_unavailable' ? 'provider_unavailable' : 'failed',
    httpStatus,
  };
  if (
    ['generation', 'persistence', 'approval', 'prescriptions', 'workout_snapshot'].includes(
      result?.stage,
    )
  )
    safe.stage = result.stage;
  if (
    [
      'coach_generation_failed',
      'provider_credentials',
      'provider_rate_limit',
      'provider_selection',
      'probe_contract_failed',
      'routine_target_mismatch',
      'invalid_routine_metadata',
      'unknown_exercise',
    ].includes(result?.code)
  )
    safe.code = result.code;
  if (
    [
      'exercise_not_found',
      'unknown_exercise',
      'routine_not_found',
      'proposal_target_changed',
      'invalid_change_selection',
      'routine_already_exists',
      'exercise_target_not_found',
      'exercise_target_ambiguous',
      'invalid_rep_range',
      'invalid_target_weight',
      'invalid_rest_period',
      'unclassified',
    ].includes(result?.rootReason)
  )
    safe.rootReason = result.rootReason;
  if (Array.isArray(result?.rootFrames))
    safe.rootFrames = result.rootFrames.filter((frame) =>
      [
        'applyProposal',
        'applyEdits',
        'resolve',
        'proposalFingerprint',
        'generateCoachReply',
      ].includes(frame),
    );
  if (
    [
      'oneOf',
      'prefixItems',
      'minItems',
      'maxItems',
      'minimum',
      'maximum',
      'pattern',
      'format',
      'default',
      'required_fields',
    ].includes(result?.schemaRule)
  )
    safe.schemaRule = result.schemaRule;
  const { diagnosticId } = safeCoachDiagnostic(result);
  if (diagnosticId) safe.diagnosticId = diagnosticId;
  return safe;
}

export function resolveAuth(env, run = spawnSync) {
  if (env.CLOUDFLARE_API_TOKEN?.trim()) return env.CLOUDFLARE_API_TOKEN.trim();
  // Official supported token retrieval handles refresh/keyring/profiles. Its
  // secret-bearing stdout is captured in memory and never printed or saved.
  const result = run('pnpm', ['exec', 'wrangler', 'auth', 'token', '--json'], {
    encoding: 'utf8',
    timeout: 25_000,
    maxBuffer: 1_000_000,
    env: { ...env, WRANGLER_SEND_METRICS: 'false' },
  });
  if (result.status !== 0) return null;
  try {
    const auth = JSON.parse(result.stdout);
    return ['oauth', 'api_token'].includes(auth.type) &&
      typeof auth.token === 'string' &&
      auth.token
      ? auth.token
      : null;
  } catch {
    return null;
  }
}

export async function cloudflareIdentity(env, config = {}, fetcher = fetch) {
  const token = resolveAuth(env);
  if (!token) throw new Error('authentication_required');
  let accountId = env.CLOUDFLARE_ACCOUNT_ID || config.account_id;
  if (!accountId) {
    const response = await fetcher('https://api.cloudflare.com/client/v4/accounts', {
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json();
    if (!response.ok || result.success === false || result.result?.length !== 1)
      throw new Error('account_selection_required');
    accountId = result.result[0].id;
  }
  if (!/^[0-9a-f]{32}$/i.test(accountId)) throw new Error('account_configuration_required');
  return { token, accountId, workerName: config.name };
}

export async function deploymentFingerprint({ token, accountId, workerName }, fetcher = fetch) {
  if (
    !token ||
    !/^[0-9a-f]{32}$/i.test(accountId || '') ||
    !/^[a-zA-Z0-9_-]{1,63}$/.test(workerName || '')
  )
    throw new Error('deployment_verification_unavailable');
  const response = await fetcher(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}/deployments`,
    {
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    },
  );
  const json = await response.json();
  const current = json.result?.deployments?.[0];
  if (!response.ok || json.success === false || !current?.id || !Array.isArray(current.versions))
    throw new Error('deployment_verification_unavailable');
  // Compare only in memory; never print account-specific deployment identifiers.
  return JSON.stringify({
    id: current.id,
    versions: current.versions
      .map(({ version_id, percentage }) => ({ version_id, percentage }))
      .sort((a, b) => a.version_id.localeCompare(b.version_id)),
  });
}

export async function queryCoachLogs({
  token,
  accountId,
  workerName,
  hours = 24,
  fetcher = fetch,
  now = Date.now(),
}) {
  if (!token) return { status: 'authentication_required' };
  if (!workerName || !/^[a-zA-Z0-9_-]{1,63}$/.test(workerName))
    return { status: 'worker_configuration_required' };
  if (!Number.isInteger(hours) || hours < 1 || hours > 72) return { status: 'invalid_time_range' };
  const api = async (path, body) => {
    const response = await fetcher(`https://api.cloudflare.com/client/v4${path}`, {
      method: body ? 'POST' : 'GET',
      redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15_000),
    });
    const json = await response.json();
    return { response, json };
  };
  try {
    if (!accountId) {
      const { response, json } = await api('/accounts');
      if (!response.ok || json.success === false)
        return { status: 'account_lookup_denied', httpStatus: response.status };
      if (!Array.isArray(json.result) || json.result.length !== 1)
        return { status: 'account_selection_required' };
      accountId = json.result[0].id;
    }
    if (!/^[0-9a-f]{32}$/i.test(accountId)) return { status: 'account_configuration_required' };
    const { response, json } = await api(
      `/accounts/${accountId}/workers/observability/telemetry/query`,
      {
        queryId: 'coach-diagnostic-read',
        view: 'events',
        dry: true,
        limit: 30,
        timeframe: { from: now - hours * 3_600_000, to: now },
        parameters: {
          filterCombination: 'and',
          filters: [
            { key: '$metadata.service', operation: 'eq', type: 'string', value: workerName },
            {
              key: '$metadata.message',
              operation: 'includes',
              type: 'string',
              value: 'Coach request failed',
            },
          ],
        },
      },
    );
    if (response.status === 403) return { status: 'log_permission_required', httpStatus: 403 };
    if (response.status === 401) return { status: 'authentication_required', httpStatus: 401 };
    if (!response.ok || json.success === false)
      return { status: 'log_query_failed', httpStatus: response.status };
    const events = json.result?.events;
    const list = Array.isArray(events) ? events : events?.events;
    if (!Array.isArray(list)) return { status: 'unexpected_log_response' };
    const diagnostics = list.map((event) => diagnosticFromSource(event.source));
    return { status: list.length ? 'logs_found' : 'no_events', count: list.length, diagnostics };
  } catch {
    return { status: 'log_transport_failed' };
  }
}

export function localProviderReadiness(paths = ['.dev.vars', 'output/coach-local/.dev.vars']) {
  return paths.some((path) => {
    if (!existsSync(path)) return false;
    try {
      const env = parseEnv(readFileSync(path, 'utf8'));
      return Boolean(env.OPENAI_API_KEY?.trim() || env.ANTHROPIC_API_KEY?.trim());
    } catch {
      return false;
    }
  });
}

async function main() {
  if (existsSync('.env.deploy.local')) process.loadEnvFile('.env.deploy.local');
  const command = process.argv[2] || 'doctor';
  if (!['doctor', 'logs'].includes(command)) {
    console.error('Use cloudflare:doctor or cloudflare:logs.');
    process.exitCode = 2;
    return;
  }
  let config = {};
  if (existsSync('wrangler.deploy.json'))
    config = JSON.parse(readFileSync('wrangler.deploy.json', 'utf8'));
  const logs = await queryCoachLogs({
    token: resolveAuth(process.env),
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID || config.account_id,
    workerName: config.name || 'lifts-coach',
  });
  console.log(
    JSON.stringify(
      { ...(command === 'doctor' ? { localProviderReady: localProviderReadiness() } : {}), logs },
      null,
      2,
    ),
  );
  if (!['logs_found', 'no_events'].includes(logs.status)) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error(
      'Cloudflare diagnostic configuration could not be read. No credential values were printed.',
    );
    process.exitCode = 2;
  });
}
