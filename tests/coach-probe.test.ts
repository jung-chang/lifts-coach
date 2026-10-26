import { afterEach, expect, it, vi } from 'vitest';
import probe from '../worker/coachProbe';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const nonce = 'synthetic-probe-guard';
const request = (path = '/__coach_verify', guard = nonce, method = 'POST') =>
  new Request(`https://preview.example.test${path}`, {
    method,
    headers: { 'X-Diagnostic-Nonce': guard },
  });

it('keeps the preview probe closed without its guard and accepts no arbitrary prompt endpoint', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  expect((await probe.fetch(request(), {})).status).toBe(403);
  expect(
    (await probe.fetch(request('/__coach_verify', 'wrong'), { DIAGNOSTIC_NONCE: nonce })).status,
  ).toBe(403);
  expect((await probe.fetch(request('/api/coach/chat'), { DIAGNOSTIC_NONCE: nonce })).status).toBe(
    404,
  );
  expect(
    (await probe.fetch(request('/__health', nonce, 'GET'), { DIAGNOSTIC_NONCE: nonce })).status,
  ).toBe(200);
  expect(fetcher).not.toHaveBeenCalled();
});

it('reports missing remote model secrets without claiming live verification', async () => {
  const response = await probe.fetch(request(), { DIAGNOSTIC_NONCE: nonce });
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ status: 'provider_unavailable' });
});

it('serializes synthetic model calls and restores capture hooks after failure', async () => {
  let started!: () => void;
  let release!: () => void;
  const start = new Promise<void>((resolve) => {
    started = resolve;
  });
  const fetcher = vi.fn(() => {
    started();
    return new Promise<Response>((resolve) => {
      release = () =>
        resolve(
          Response.json(
            { error: { type: 'invalid_api_key', message: 'synthetic private detail' } },
            { status: 401 },
          ),
        );
    });
  });
  vi.stubGlobal('fetch', fetcher);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const env = { DIAGNOSTIC_NONCE: nonce, OPENAI_API_KEY: 'synthetic-key' };
  const first = probe.fetch(request(), env);
  await start;
  expect((await probe.fetch(request(), env)).status).toBe(429);
  expect(fetcher).toHaveBeenCalledTimes(1);
  release();
  expect((await first).status).toBe(503);
  expect(console.error).toBe(log);
  expect(JSON.stringify(log.mock.calls)).not.toContain('synthetic private detail');
  expect((await probe.fetch(request(), { DIAGNOSTIC_NONCE: nonce })).status).toBe(503);
});

it('checks SDK output through persistence, approval and workout snapshots using only synthetic context', async () => {
  const fetcher = vi.fn(async (_url, init) => {
    const payload = JSON.parse(init.body);
    const reply = {
      text: 'Review this synthetic routine.',
      evidenceIds: [],
      proposals: [
        {
          scope: 'routine',
          targetId: '',
          edits: [],
          rationale: 'Requested routine',
          evidenceIds: [],
          preference: null,
          customExercise: null,
          routineDraft: {
            name: 'Synthetic upper body',
            exercises: ['ex_pull-up', 'ex_dumbbell-bench', 'ex_dumbbell-shoulder-press'].map(
              (exerciseId, index) => ({
                exerciseId,
                sets: 3,
                repRange: [3, 3],
                restSeconds: 120,
                targetWeight: index ? 50 : 0,
                loadMode: index ? 'per-dumbbell' : 'bodyweight',
              }),
            ),
          },
        },
      ],
    };
    return Response.json({
      id: 'resp_synthetic',
      created_at: 1,
      model: payload.model,
      status: 'completed',
      output: [
        {
          id: 'msg_synthetic',
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: JSON.stringify(reply), annotations: [] }],
        },
      ],
      usage: { input_tokens: 20, output_tokens: 30, total_tokens: 50 },
    });
  });
  vi.stubGlobal('fetch', fetcher);
  const response = await probe.fetch(request(), {
    DIAGNOSTIC_NONCE: nonce,
    OPENAI_API_KEY: 'synthetic-key',
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    status: 'passed',
    exercises: 3,
    setsPerExercise: 3,
    repsPerSet: 3,
    poundsPerDumbbell: 50,
    approvalVerified: true,
    workoutSnapshotVerified: true,
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const context = JSON.parse(
    JSON.parse(fetcher.mock.calls[0][1].body).input.find(
      (item: { role: string }) => item.role === 'user',
    ).content[0].text,
  ).context;
  expect(context.routines).toEqual([]);
  expect(context.recentHistory).toEqual([]);
});
