import { afterEach, describe, expect, it, vi } from 'vitest';
import { coachReply } from '../worker/coach';
import { coachSelection } from '../shared/coachSelection';
import { applyProposal, createPrescription, createRoutine, emptyData } from '../shared/domain';
import { catalog } from '../shared/catalog';

afterEach(() => vi.unstubAllGlobals());
const env = { OPENAI_API_KEY: 'synthetic-test-key' };
const request = { message: 'Help me build a routine', provider: 'openai', model: '' };
const proposal = {
  scope: 'routine',
  targetId: '',
  edits: [],
  rationale: 'Requested plan',
  evidenceIds: [],
  routineDraft: null,
  preference: null,
  customExercise: null,
};

function mockOpenAI(reply: unknown) {
  let captured: any;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, init) => {
      captured = JSON.parse(init.body);
      return Response.json({
        id: 'resp_synthetic',
        created_at: 1,
        model: captured.model,
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
    }),
  );
  return () => captured;
}

function assertStrictSchema(node: any) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'object') {
    expect(node.additionalProperties).toBe(false);
    expect([...(node.required || [])].sort()).toEqual(Object.keys(node.properties).sort());
  }
  if (node.type === 'array') expect(Array.isArray(node.items)).toBe(false);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(assertStrictSchema);
    else if (value && typeof value === 'object') assertStrictSchema(value);
  }
}

describe('Coach provider integration', () => {
  it('defaults blank model settings and sends a strict-compatible schema through the real SDK', async () => {
    const captured = mockOpenAI({
      text: 'What equipment do you have?',
      evidenceIds: [],
      proposals: [],
    });
    const data = emptyData();
    data.messages = [
      {
        id: 'prior',
        role: 'user',
        text: 'I train twice a week',
        createdAt: new Date().toISOString(),
      },
    ];
    const result = await coachReply(env, data, request);
    expect(result.text).toBe('What equipment do you have?');
    expect(captured().model).toBe('gpt-5-mini');
    expect(JSON.stringify(captured().input)).toContain('I train twice a week');
    assertStrictSchema(captured().text.format.schema);
    expect(result.proposals).toEqual([]);
  });

  it('builds a new routine as a reviewed proposal without changing saved data', async () => {
    const data = emptyData();
    const routine = {
      ...createRoutine('Synthetic two-day plan'),
      exercises: [createPrescription(catalog[0].id)],
    };
    mockOpenAI({
      text: 'Here is a plan for review.',
      evidenceIds: [],
      proposals: [{ ...proposal, targetId: routine.id, routineDraft: routine }],
    });
    const result = await coachReply(env, data, request);
    expect(data.routines).toEqual([]);
    const approved = applyProposal(
      { ...data, proposals: result.proposals },
      result.proposals[0].id,
      [0],
    );
    expect(approved.routines[0].name).toBe(routine.name);
  });

  it('validates exercise edits and applies only after approval', async () => {
    const routine = {
      ...createRoutine('Synthetic routine'),
      exercises: [createPrescription(catalog[0].id)],
    };
    const data = { ...emptyData(), routines: [routine] };
    mockOpenAI({
      text: 'Review this adjustment.',
      evidenceIds: [],
      proposals: [
        {
          ...proposal,
          targetId: routine.id,
          edits: [
            {
              op: 'update_exercise',
              exerciseId: routine.exercises[0].id,
              sets: 4,
              repRange: [6, 8],
              restSeconds: null,
              targetWeight: null,
            },
          ],
        },
      ],
    });
    const result = await coachReply(env, data, request);
    expect(data.routines[0].exercises[0].sets).toBe(3);
    const approved = applyProposal(
      { ...data, proposals: result.proposals },
      result.proposals[0].id,
      [0],
    );
    expect(approved.routines[0].exercises[0].sets).toBe(4);
  });

  it('selects a provisioned default while preserving a valid saved choice', () => {
    const providers = [{ id: 'openai', models: ['default', 'chosen'] }];
    expect(coachSelection(providers, { provider: 'openai', model: '' })?.model).toBe('default');
    expect(coachSelection(providers, { provider: 'openai', model: 'chosen' })?.model).toBe(
      'chosen',
    );
    expect(coachSelection([], { provider: 'openai', model: '' })).toBeNull();
  });

  it('reports provider credentials separately from invalid user requests without leaking provider bodies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { error: { message: 'synthetic private provider detail', type: 'invalid_api_key' } },
          { status: 401 },
        ),
      ),
    );
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(coachReply(env, emptyData(), request)).rejects.toMatchObject({
        status: 503,
        code: 'provider_credentials',
      });
      expect(JSON.stringify(log.mock.calls)).not.toContain('synthetic private provider detail');
    } finally {
      log.mockRestore();
    }
  });
});
