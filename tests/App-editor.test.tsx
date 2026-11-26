// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyData, startWorkout, validateBackup } from '../shared/domain';
import App from '../src/App';

const fixture = vi.hoisted(() => ({
  update: vi.fn(),
  data: null as any,
  session: null as any,
  refreshSession: vi.fn(),
}));
vi.mock('../src/lib/store', () => ({
  useAppStore: () => ({
    data: fixture.data,
    session: fixture.session,
    identityStatus: 'verified',
    refreshSession: fixture.refreshSession,
    syncStatus: 'synced',
    update: fixture.update,
    conflict: null,
    retrySync: vi.fn(),
    resolveConflict: vi.fn(),
    exportData: vi.fn(),
    importData: vi.fn(),
  }),
}));

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  fixture.data = emptyData();
  fixture.session = {
    accountId: 'synthetic-account',
    email: 'member@example.test',
    coachEnabled: true,
    profileSetupRequired: false,
    profile: { publicId: 'synthetic-profile', displayName: 'Member', trainingTimezone: 'UTC' },
    sharing: {
      summaryEnabled: false,
      autoPublishWorkouts: false,
      policyRevision: 1,
      audienceAcknowledgedAt: null,
      enabledAt: null,
    },
  };
  fixture.update.mockReset();
  fixture.update.mockImplementation(async (updater) => {
    fixture.data = updater(fixture.data);
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ providers: [] })),
  );
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
  window.history.replaceState(null, '', '/');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function startDraft() {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Create routine' }));
  fireEvent.change(screen.getByLabelText('Routine name'), {
    target: { value: 'Synthetic push plan' },
  });
}

describe('integrated editor navigation', () => {
  it('saves another member’s workout as an independent, editable routine', async () => {
    const profile = { publicId: 'synthetic-peer', displayName: 'Alex', trainingTimezone: 'UTC' };
    const completedAt = '2026-10-18T15:00:00.000Z';
    const workout = {
      id: 'pub-example',
      title: 'Upper body',
      profile,
      startedAt: '2026-10-18T14:00:00.000Z',
      completedAt,
      exercises: [
        {
          id: 'shared-bench',
          exerciseId: 'ex_barbell-bench-press',
          name: 'Barbell Bench Press',
          loadMode: 'external',
          sets: [
            { id: 'warmup', kind: 'warmup', weight: 45, reps: 12, loadMode: 'external' },
            { id: 'work-1', kind: 'working', weight: 95, reps: 8, loadMode: 'external' },
            { id: 'work-2', kind: 'working', weight: 90, reps: 6, loadMode: 'external' },
          ],
        },
        {
          id: 'shared-pull',
          exerciseId: 'custom-peer-pull',
          name: 'Example assisted pull',
          loadMode: 'assistance',
          sets: [{ id: 'work-3', kind: 'working', weight: 25, reps: 5, loadMode: 'assistance' }],
        },
      ],
    };
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/feed'))
        return Response.json({
          items: [
            {
              id: workout.id,
              profile,
              title: workout.title,
              activityAt: completedAt,
              exerciseCount: 2,
              setCount: 3,
              durationMinutes: 60,
              exerciseNames: ['Barbell Bench Press', 'Example assisted pull'],
            },
          ],
          nextCursor: null,
        });
      if (url.endsWith(workout.id)) return Response.json(workout);
      return Response.json([]);
    });

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Community' }));
    fireEvent.click(await screen.findByRole('button', { name: /View Upper body workout by Alex/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Use workout' }));
    expect(screen.getByLabelText('Routine name')).toHaveProperty('value', 'Upper body');
    expect(fixture.update).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Routine name'), { target: { value: 'My upper body' } });
    const save = screen.getByRole('button', { name: 'Save routine' });
    fireEvent.click(save);
    fireEvent.click(save);

    await screen.findByRole('button', { name: 'Delete My upper body' });
    const data = validateBackup(fixture.data);
    expect(data.workouts).toEqual([]);
    expect(data.routines).toHaveLength(1);
    expect(data.exercises).toHaveLength(1);
    const routine = data.routines[0];
    expect(routine.exercises).toMatchObject([
      { exerciseId: 'ex_barbell-bench-press', sets: 2, repRange: [6, 8], targetWeight: 95 },
      {
        exerciseId: data.exercises[0].id,
        sets: 1,
        repRange: [5, 5],
        targetWeight: 25,
        loadMode: 'assistance',
      },
    ]);
    expect(data.exercises[0].id).not.toBe(workout.exercises[1].exerciseId);
    expect(startWorkout(data, routine.id).workouts[0].exercises[1].actualSets[0]).toMatchObject({
      kind: 'working',
      status: 'incomplete',
      loadMode: 'assistance',
    });
  });

  it('shows profile setup before training for a newly verified account', () => {
    fixture.session.profileSetupRequired = true;
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Your profile' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create routine' })).toBeNull();
  });
  it('hides Coach controls for members while allowing manual routine creation', () => {
    fixture.session.coachEnabled = false;
    render(<App />);
    expect(screen.queryByRole('button', { name: /Ask Coach/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Create routine' }));
    expect(screen.getByLabelText('Routine name')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Ask Coach/ })).toBeNull();
  });
  it.each([false, true])(
    'finishes without separate sharing controls when profile sharing is %s',
    async (sharing) => {
      fixture.session.coachEnabled = false;
      fixture.session.sharing.summaryEnabled = sharing;
      fixture.session.sharing.autoPublishWorkouts = sharing;
      render(<App />);
      fireEvent.click(screen.getByRole('button', { name: 'Use starter routine' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Start workout' }));
      fireEvent.click(await screen.findByRole('checkbox', { name: 'Set 1 done' }));
      fireEvent.click(screen.getByRole('button', { name: 'Finish workout' }));
      const summary = await screen.findByRole('dialog', { name: 'Workout saved' });
      expect(within(summary).queryByText('Workout visibility')).toBeNull();
      expect(within(summary).queryByRole('button', { name: 'Share workout' })).toBeNull();
      expect(fixture.data.workouts[0].communityVisibility.visibility).toBe(
        sharing ? 'community' : 'private',
      );
      expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
    },
  );
  it('opens routine creation directly with the new title field focused', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Create routine' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Routine name'));
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'auto' });
    fireEvent.change(screen.getByLabelText('Routine name'), {
      target: { value: 'Synthetic title' },
    });
    expect(window.scrollTo).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fixture.update).not.toHaveBeenCalled();
  });

  it('requires confirmation before deleting a saved routine', async () => {
    const { createRoutine } = await import('../shared/domain');
    fixture.data = { ...emptyData(), routines: [createRoutine('Synthetic push plan')] };
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Synthetic push plan' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete routine?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(fixture.data.routines).toHaveLength(1);
    expect(fixture.update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Synthetic push plan' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Delete routine?' })).getByRole('button', {
        name: 'Yes, delete',
      }),
    );
    await waitFor(() => expect(fixture.data.routines).toHaveLength(0));
  });

  it('preserves and resumes a changed draft while using full Coach', async () => {
    startDraft();
    fireEvent.click(screen.getByRole('button', { name: 'Ask Coach' }));
    expect(screen.getByRole('heading', { name: 'Coach' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Message Coach' })).toHaveProperty(
      'value',
      expect.stringContaining('Help improve this unsaved routine draft'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Build a routine' }));
    expect(screen.getByRole('alert').textContent).toContain('Save or discard your current draft');
    fireEvent.click(screen.getByRole('button', { name: 'Train' }));
    expect(screen.getByLabelText('Routine name')).toHaveProperty('value', 'Synthetic push plan');
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    expect(fixture.update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Ask Coach' }));
    fireEvent.popState(window);
    expect(screen.getByLabelText('Routine name')).toHaveProperty('value', 'Synthetic push plan');
    expect(screen.queryByRole('dialog', { name: 'Discard routine changes?' })).toBeNull();
  });

  it('saves a draft then exits without triggering its dirty Back confirmation', async () => {
    startDraft();
    fireEvent.click(screen.getByRole('button', { name: 'Add exercise' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search exercises' }), {
      target: { value: 'Barbell bench press' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Barbell bench press.*chest/i }));
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {
      window.history.replaceState(null, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save routine' }));
    await waitFor(() => expect(screen.queryByLabelText('Routine name')).toBeNull());
    expect(fixture.data.routines[0].name).toBe('Synthetic push plan');
    expect(screen.queryByRole('dialog', { name: 'Discard routine changes?' })).toBeNull();
    expect(back).toHaveBeenCalledOnce();
    back.mockRestore();
  });
});
