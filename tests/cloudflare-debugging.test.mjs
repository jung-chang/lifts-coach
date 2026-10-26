import { describe, expect, it, vi } from 'vitest';
import {
  diagnosticFromSource,
  queryCoachLogs,
  resolveAuth,
  safeCoachDiagnostic,
  safeProbeReport,
  deploymentFingerprint,
} from '../scripts/diagnose-cloudflare.mjs';
import { localOrigin, verifyLiveCoach, verifyRoutineReply } from '../scripts/verify-cloudflare.mjs';
import { coachDiagnostic } from '../worker/coachDiagnostics';

const accountId = '0123456789abcdef0123456789abcdef';
const diagnosticId = '12345678-1234-4123-8123-123456789abc';
const routineReply = () => ({
  proposals: [
    {
      scope: 'routine',
      status: 'pending',
      routineDraft: {
        id: 'routine_synthetic',
        exercises: ['ex_pull-up', 'ex_dumbbell-bench', 'ex_dumbbell-shoulder-press'].map(
          (exerciseId, index) => ({
            exerciseId,
            sets: 3,
            repRange: [3, 3],
            targetWeight: index ? 50 : 0,
            loadMode: index ? 'per-dumbbell' : 'bodyweight',
          }),
        ),
      },
    },
  ],
});

describe('Cloudflare debugging privacy and readiness', () => {
  it('requires every live-probe contract and rejects arbitrary strings even under known field names', () => {
    const passed = {
      status: 'passed',
      exercises: 3,
      setsPerExercise: 3,
      repsPerSet: 3,
      poundsPerDumbbell: 50,
      approvalVerified: true,
      workoutSnapshotVerified: true,
    };
    expect(safeProbeReport(passed, 200).status).toBe('passed');
    expect(safeProbeReport({ ...passed, approvalVerified: false }, 200).status).toBe('failed');
    expect(safeProbeReport(passed, 502).status).toBe('failed');
    const safe = safeProbeReport(
      {
        status: 'private body',
        code: 'private key',
        stage: 'private profile',
        rootReason: 'private note',
        rootFrames: ['private stack'],
        diagnosticId: 'private-id',
      },
      502,
    );
    expect(JSON.stringify(safe)).not.toContain('private');
  });

  it('verifies active deployment identity and traffic while ignoring private author metadata', async () => {
    const identity = { token: 'synthetic', accountId, workerName: 'lifts-coach' };
    const version = { version_id: 'synthetic-version', percentage: 100 };
    const fetcher = (id, email) => async () =>
      Response.json({
        success: true,
        result: { deployments: [{ id, versions: [version], author_email: email }] },
      });
    const before = await deploymentFingerprint(
      identity,
      fetcher('synthetic-deployment', 'first@example.test'),
    );
    const after = await deploymentFingerprint(
      identity,
      fetcher('synthetic-deployment', 'second@example.test'),
    );
    expect(before).toBe(after);
    expect(before).not.toContain('example.test');
    expect(
      await deploymentFingerprint(identity, fetcher('different-deployment', 'first@example.test')),
    ).not.toBe(before);
    await expect(
      deploymentFingerprint(identity, async () => Response.json({}, { status: 403 })),
    ).rejects.toThrow('deployment_verification_unavailable');
  });
  it('uses the supported Wrangler token command without printing or reading credential files', () => {
    const run = vi.fn(() => ({
      status: 0,
      stdout: JSON.stringify({ type: 'oauth', token: 'synthetic-credential' }),
    }));
    expect(resolveAuth({}, run)).toBe('synthetic-credential');
    expect(run.mock.calls[0][1]).toEqual(['exec', 'wrangler', 'auth', 'token', '--json']);
    expect(resolveAuth({ CLOUDFLARE_API_TOKEN: 'explicit-synthetic' }, run)).toBe(
      'explicit-synthetic',
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(resolveAuth({}, () => ({ status: 1, stdout: 'private credential body' }))).toBeNull();
  });

  it('projects a closed set of diagnostic fields and discards messages, bodies and malicious field values', () => {
    const raw = {
      name: 'AI_APICallError',
      status: 400,
      code: 'invalid_json_schema',
      stage: 'provider_request',
      diagnosticId,
      message: 'private prompt',
      schemaError: 'private upstream body',
      headers: { authorization: 'private-key' },
      email: 'private@example.test',
    };
    expect(safeCoachDiagnostic(raw)).toEqual({
      name: 'AI_APICallError',
      status: 400,
      code: 'invalid_json_schema',
      stage: 'provider_request',
      diagnosticId,
      schemaRejected: true,
    });
    expect(
      safeCoachDiagnostic({
        name: 'private-key',
        code: 'private-key',
        stage: 'private-key',
        diagnosticId: 'private-key',
        status: 'private-key',
      }),
    ).toEqual({});
    const worker = coachDiagnostic(
      {
        name: 'private-key',
        statusCode: 400,
        data: { error: { code: 'invalid_json_schema', message: 'private prompt' } },
      },
      'provider_request',
      diagnosticId,
    );
    expect(JSON.stringify(worker)).not.toContain('private');
    expect(worker.schemaRejected).toBe(true);
    expect(
      diagnosticFromSource({ message: 'Coach request failed ' + JSON.stringify(raw) }),
    ).toEqual(safeCoachDiagnostic(raw));
  });

  it('distinguishes denied log permissions from an empty successful query', async () => {
    const options = { token: 'synthetic', accountId, workerName: 'lifts-coach' };
    expect(
      await queryCoachLogs({
        ...options,
        fetcher: async () => Response.json({ errors: [{ message: 'private' }] }, { status: 403 }),
      }),
    ).toEqual({ status: 'log_permission_required', httpStatus: 403 });
    const fetcher = vi.fn(async () => Response.json({ success: true, result: { events: [] } }));
    expect(await queryCoachLogs({ ...options, fetcher })).toEqual({
      status: 'no_events',
      count: 0,
      diagnostics: [],
    });
    const sent = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(sent.dry).toBe(true);
    expect(sent.parameters.filters).toContainEqual({
      key: '$metadata.service',
      operation: 'eq',
      type: 'string',
      value: 'lifts-coach',
    });
    expect(fetcher.mock.calls[0][1].redirect).toBe('error');
  });

  it('does not guess an account, follow redirects, or dump unexpected API responses', async () => {
    expect(
      await queryCoachLogs({
        token: 'synthetic',
        workerName: 'lifts-coach',
        fetcher: async () => Response.json({ result: [{ id: accountId }, { id: 'other' }] }),
      }),
    ).toEqual({ status: 'account_selection_required' });
    expect(
      await queryCoachLogs({
        token: 'synthetic',
        accountId,
        workerName: 'lifts-coach',
        fetcher: async () => {
          throw new Error('private transport headers');
        },
      }),
    ).toEqual({ status: 'log_transport_failed' });
    expect(
      await queryCoachLogs({
        token: 'synthetic',
        accountId,
        workerName: 'lifts-coach',
        fetcher: async () => Response.json({ result: { privateData: 'private' } }),
      }),
    ).toEqual({ status: 'unexpected_log_response' });
  });
});

describe('isolated live Coach verification contract', () => {
  it('rejects production origins and credential-bearing URLs before making any requests', async () => {
    for (const origin of [
      'https://lifts.coach',
      'http://127.0.0.1.evil.test',
      'http://user:password@localhost:8877',
      'http://localhost:8877/path',
    ])
      expect(() => localOrigin(origin)).toThrow('local_origin_required');
    expect(localOrigin('http://127.0.0.1:8877')).toBe('http://127.0.0.1:8877');
    const fetcher = vi.fn();
    await expect(verifyLiveCoach('https://lifts.coach', fetcher)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('fails on wrong reps, combined dumbbell loads, or silently applied proposals', () => {
    expect(verifyRoutineReply(routineReply()).poundsPerDumbbell).toBe(50);
    const wrongLoad = routineReply();
    wrongLoad.proposals[0].routineDraft.exercises[1].targetWeight = 100;
    expect(() => verifyRoutineReply(wrongLoad)).toThrow('load_mismatch');
    const wrongReps = routineReply();
    wrongReps.proposals[0].routineDraft.exercises[0].repRange = [3, 5];
    expect(() => verifyRoutineReply(wrongReps)).toThrow('prescription_mismatch');
    const applied = routineReply();
    applied.proposals[0].status = 'accepted';
    expect(() => verifyRoutineReply(applied)).toThrow('unreviewed_change_applied');
  });

  it('requires the real HTTP reply and verifies training state stays unchanged', async () => {
    const state = { data: { routines: [], workouts: [] } };
    const fetcher = vi.fn(async (url) =>
      Response.json(
        url.endsWith('/api/providers')
          ? [{ id: 'openai', models: ['synthetic-model'] }]
          : url.endsWith('/api/session')
            ? { accountId: 'synthetic-account' }
            : url.endsWith('/api/state')
              ? state
              : routineReply(),
      ),
    );
    expect(await verifyLiveCoach('http://127.0.0.1:8877', fetcher)).toMatchObject({
      status: 'passed',
      trainingStateUnchanged: true,
      poundsPerDumbbell: 50,
    });
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/api/state'))).toHaveLength(2);
    const request = fetcher.mock.calls.find(([url]) => url.endsWith('/api/coach/chat'))[1];
    expect(request.headers['X-Lifts-Account']).toBe('synthetic-account');
    expect(JSON.parse(request.body).message).toContain('each three sets three reps');
  });

  it('never treats missing providers or provider failures as live verification success', async () => {
    await expect(
      verifyLiveCoach('http://localhost:8877', async () => Response.json([])),
    ).rejects.toThrow('local_provider_required');
    const fetcher = async (url) =>
      url.endsWith('/api/coach/chat')
        ? Response.json(
            { code: 'coach_generation_failed', diagnosticId, error: 'private upstream body' },
            { status: 502 },
          )
        : Response.json(
            url.endsWith('/api/providers') ? [{ id: 'openai', models: ['synthetic-model'] }] : {},
          );
    const result = await verifyLiveCoach('http://localhost:8877', fetcher);
    expect(result).toEqual({
      status: 'failed',
      httpStatus: 502,
      diagnosticId,
      appCode: 'coach_generation_failed',
    });
    expect(JSON.stringify(result)).not.toContain('private');
  });
});
