// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  emptyData,
  createRoutine,
  createPrescription,
  proposalFingerprint,
  startWorkout,
} from '../shared/domain';
import { catalog } from '../shared/catalog';
import type { Proposal } from '../shared/types';
import App from '../src/App';

const fixture = vi.hoisted(() => ({ data: null as any, update: vi.fn() }));
vi.mock('../src/lib/store', () => ({
  useAppStore: () => ({
    data: fixture.data,
    session: {
      accountId: 'synthetic-coach',
      email: 'coach@example.test',
      coachEnabled: true,
      profile: {
        publicId: 'synthetic-profile',
        displayName: 'Coach member',
        trainingTimezone: 'UTC',
      },
      sharing: {
        summaryEnabled: false,
        autoPublishWorkouts: false,
        policyRevision: 1,
        audienceAcknowledgedAt: null,
        enabledAt: null,
      },
    },
    update: fixture.update,
    syncStatus: 'synced',
    conflict: null,
  }),
}));
beforeEach(() => {
  fixture.data = emptyData();
  fixture.update.mockImplementation(async (update) => {
    fixture.data = update(fixture.data);
  });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('keeps one Coach entry icon on primary views and carries the active exercise context', async () => {
  const routine = createRoutine('Synthetic active Coach plan');
  routine.exercises = [createPrescription(catalog[0].id)];
  fixture.data = startWorkout({ ...emptyData(), routines: [routine] }, routine.id);
  const activeWorkout = fixture.data.workouts[0];
  const requests: any[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init) => {
      if (url === '/api/providers')
        return Response.json([{ id: 'openai', models: ['gpt-5-mini'] }]);
      if (url === '/api/coach/chat') {
        requests.push(JSON.parse(init.body));
        return Response.json({ text: 'Context received.', proposals: [], evidence: [] });
      }
      return Response.json([]);
    }),
  );
  render(<App />);
  const expectOneCoachIcon = () =>
    expect(screen.getAllByRole('button', { name: /^Ask Coach$/ })).toHaveLength(1);
  expectOneCoachIcon(); // active Train
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Ask Coach' }));
  });
  expect(screen.getByRole('heading', { name: 'Coach' })).toBeTruthy();
  fireEvent.change(screen.getByRole('textbox', { name: 'Message Coach' }), {
    target: { value: 'How should I approach this session?' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await screen.findByText('Context received.');
  expect(requests[0].context).toEqual({
    workoutId: activeWorkout.id,
    exerciseId: activeWorkout.exercises[0].exerciseId,
  });

  fireEvent.click(screen.getByRole('button', { name: 'Train' }));
  expectOneCoachIcon();
  fireEvent.click(screen.getByRole('button', { name: 'Progress' }));
  expectOneCoachIcon();
  fireEvent.click(screen.getByRole('button', { name: 'Community' }));
  expectOneCoachIcon();
  fireEvent.click(screen.getByRole('button', { name: 'Your profile' }));
  expectOneCoachIcon();
});

it('chats across turns with a provisioned default when the saved model is blank', async () => {
  const requests: any[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init) => {
      if (url === '/api/providers')
        return Response.json([{ id: 'openai', models: ['gpt-5-mini'] }]);
      requests.push(JSON.parse(init.body));
      return Response.json({
        text: `Synthetic reply ${requests.length}`,
        proposals: [],
        evidence: [],
      });
    }),
  );
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Ask Coach' }));
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(0));
  fireEvent.change(screen.getByRole('textbox', { name: 'Message Coach' }), {
    target: { value: 'I train twice a week' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await screen.findByText('Synthetic reply 1');
  fireEvent.change(screen.getByRole('textbox', { name: 'Message Coach' }), {
    target: { value: 'Help me build a routine' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await screen.findByText('Synthetic reply 2');
  expect(requests.map((request) => request.model)).toEqual(['gpt-5-mini', 'gpt-5-mini']);
  expect(fixture.data.messages.map((message: any) => message.role)).toEqual([
    'user',
    'assistant',
    'user',
    'assistant',
  ]);
});

it('shows the server provider error instead of claiming no provider is configured', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) =>
      url === '/api/providers'
        ? Response.json([{ id: 'openai', models: ['gpt-5-mini'] }])
        : Response.json({ error: 'The Coach provider rejected its credentials.' }, { status: 503 }),
    ),
  );
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Ask Coach' }));
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(0));
  fireEvent.change(screen.getByRole('textbox', { name: 'Message Coach' }), {
    target: { value: 'Hello' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await screen.findByText('The Coach provider rejected its credentials.');
});

it('reviews an AI routine in the shared editor and persists it only after Save', async () => {
  const routine = {
    ...createRoutine('Synthetic AI plan'),
    exercises: [createPrescription(catalog[0].id)],
  };
  const proposal: Proposal = {
    id: 'synthetic-routine-proposal',
    scope: 'routine',
    targetId: routine.id,
    edits: [],
    rationale: 'Requested training plan',
    evidenceIds: [],
    routineDraft: routine,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  proposal.targetFingerprint = proposalFingerprint(fixture.data, proposal);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) =>
      url === '/api/providers'
        ? Response.json([{ id: 'openai', models: ['gpt-5-mini'] }])
        : Response.json({ text: 'Review this routine.', proposals: [proposal], evidence: [] }),
    ),
  );
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Ask Coach' }));
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(0));
  fireEvent.change(screen.getByRole('textbox', { name: 'Message Coach' }), {
    target: { value: 'Create a routine for me' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await screen.findByText('Review this routine.');
  expect(fixture.data.routines).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'Open routine editor' }));
  expect(screen.getByLabelText('Routine name')).toHaveProperty('value', routine.name);
  expect(fixture.data.routines).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'Approve and save' }));
  await waitFor(() => expect(fixture.data.routines[0]?.name).toBe(routine.name));
  expect(fixture.data.routines[0].exercises[0].exerciseId).toBe(catalog[0].id);
  expect(fixture.data.proposals[0].status).toBe('accepted');
});
