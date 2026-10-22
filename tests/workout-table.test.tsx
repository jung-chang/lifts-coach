// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalog } from '../shared/catalog';
import {
  createPrescription,
  createRoutine,
  emptyData,
  startWorkout as startWorkoutDomain,
} from '../shared/domain';
import App from '../src/App';

const fixture = vi.hoisted(() => ({ update: vi.fn(), data: null as any }));
vi.mock('../src/lib/store', () => ({
  useAppStore: () => ({
    data: fixture.data,
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
  const routine = createRoutine('Synthetic table routine');
  routine.exercises = [{ ...createPrescription(catalog[0].id), sets: 3, targetWeight: 45 }];
  fixture.data = { ...emptyData(), routines: [routine] };
  fixture.update.mockReset();
  fixture.update.mockImplementation(async (updater) => {
    fixture.data = updater(fixture.data);
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json([])),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function beginWorkout() {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Start workout' }));
  await screen.findByRole('table', { name: /sets/i });
}

describe('workout set table', () => {
  it('saves exercise feedback during training and workout feedback after finish', async () => {
    await beginWorkout();
    expect(screen.queryByRole('group', { name: 'Workout difficulty' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: /Workout note/ })).toBeNull();
    expect(screen.getByLabelText('Notes (optional)').closest('details')?.hasAttribute('open')).toBe(
      false,
    );
    fireEvent.click(screen.getByLabelText('Notes (optional)'));
    const effort = screen.getByRole('group', { name: 'Exercise difficulty' });
    expect(within(effort).getAllByRole('button')).toHaveLength(3);
    fireEvent.click(within(effort).getByRole('button', { name: 'Hard' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Exercise note/ }), {
      target: { value: 'Synthetic exercise note' },
    });
    await waitFor(() =>
      expect(fixture.data.workouts[0].exercises[0].notes).toBe('Synthetic exercise note'),
    );
    expect(fixture.data.workouts[0].exercises[0].repsInReserve).toBeUndefined();
    expect(fixture.data.workouts[0].exercises[0].feeling).toBe('hard');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Set 1 done' }));
    await screen.findByRole('button', { name: /Undo/ });
    fireEvent.change(screen.getByRole('textbox', { name: /Exercise note/ }), {
      target: { value: 'Edited after set completion' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Undo/ }));
    await waitFor(() =>
      expect(fixture.data.workouts[0].exercises[0].actualSets[0].status).toBe('incomplete'),
    );
    expect(fixture.data.workouts[0].exercises[0].notes).toBe('Edited after set completion');
    fireEvent.click(screen.getByRole('button', { name: 'Finish workout' }));
    await waitFor(() => expect(fixture.data.workouts[0].status).toBe('finished'));
    expect(fixture.data.workouts[0].exercises[0].notes).toBe('Edited after set completion');
    expect(fixture.data.workouts[0].exercises[0].feeling).toBe('hard');
    const savedDialog = await screen.findByRole('dialog', { name: 'Workout saved' });
    const workoutNote = within(savedDialog).getByRole('textbox', { name: /Workout note/ });
    fireEvent.change(workoutNote, { target: { value: 'Synthetic workout note' } });
    await waitFor(() => expect(fixture.data.workouts[0].notes).toBe('Synthetic workout note'));
    expect(fixture.data.workouts[0].exercises[0].notes).toBe('Edited after set completion');
    const workoutDifficulty = within(savedDialog).getByRole('group', {
      name: 'Workout difficulty',
    });
    fireEvent.click(within(workoutDifficulty).getByRole('button', { name: 'Good' }));
    await waitFor(() => expect(fixture.data.workouts[0].feeling).toBe('good'));
    expect(fixture.data.workouts[0].notes).toBe('Synthetic workout note');
  });

  it('shows prior session notes without putting them into today’s fields and renders saved history feedback', async () => {
    let started = startWorkoutDomain(fixture.data, fixture.data.routines[0].id);
    const previous = started.workouts[0];
    previous.status = 'finished';
    previous.startedAt = '2026-01-01T12:00:00Z';
    previous.completedAt = '2026-01-01T13:00:00Z';
    previous.notes = 'Synthetic prior workout note';
    previous.exercises[0].notes = 'Synthetic prior exercise note';
    previous.exercises[0].feeling = 'good';
    previous.exercises[0].actualSets[0].status = 'completed';
    fixture.data = startWorkoutDomain(started, fixture.data.routines[0].id);
    const view = render(<App />);
    expect(screen.getByText(/Last time.*Synthetic prior exercise note/)).toBeTruthy();
    expect(screen.queryByText(/Last workout.*Synthetic prior workout note/)).toBeNull();
    fireEvent.click(screen.getByLabelText('Notes (optional)'));
    expect(screen.getByRole('textbox', { name: /Exercise note/ })).toHaveProperty('value', '');
    expect(screen.queryByRole('textbox', { name: /Workout note/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Finish workout' }));
    const savedDialog = await screen.findByRole('dialog', { name: 'Workout saved' });
    expect(
      within(savedDialog).getByText(/Last workout.*Synthetic prior workout note/),
    ).toBeTruthy();
    expect(within(savedDialog).getByRole('textbox', { name: /Workout note/ })).toHaveProperty(
      'value',
      '',
    );
    view.unmount();
    fixture.data = { ...started, workouts: [previous] };
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Progress' }));
    fireEvent.click(screen.getByRole('button', { name: /Workout history/ }));
    fireEvent.click(screen.getByRole('button', { name: previous.name }));
    expect(screen.getByText('Synthetic prior exercise note')).toBeTruthy();
    expect(screen.getByText('Good')).toBeTruthy();
    expect(screen.getByText('Synthetic prior workout note')).toBeTruthy();
  });

  it('replaces an exercise through a searchable drawer without changing the routine', async () => {
    await beginWorkout();
    const routineBefore = structuredClone(fixture.data.routines);
    fireEvent.click(screen.getByLabelText('Notes (optional)'));
    fireEvent.change(screen.getByRole('textbox', { name: /Exercise note/ }), {
      target: { value: 'Synthetic original exercise note' },
    });
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Exercise difficulty' })).getByRole('button', {
        name: 'Hard',
      }),
    );
    await waitFor(() => expect(fixture.data.workouts[0].exercises[0].feeling).toBe('hard'));
    expect(screen.queryByRole('button', { name: 'Options' })).toBeNull();
    expect(screen.queryByText('Skip exercise')).toBeNull();
    expect(screen.queryByText('Move exercise')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Replace exercise' }));
    const search = screen.getByRole('searchbox', { name: 'Search replacement exercises' });
    fireEvent.change(search, { target: { value: 'no such synthetic exercise' } });
    expect(screen.getByText('No exercises found.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    const replacement = catalog.find((item) => item.id !== catalog[0].id)!;
    fireEvent.change(search, { target: { value: replacement.name } });
    const dialog = screen.getByRole('dialog', { name: 'Replace exercise' });
    fireEvent.click(
      within(dialog).getByRole('button', {
        name: `${replacement.name} ${replacement.muscles.join(', ')} · ${replacement.equipment}`,
      }),
    );
    await waitFor(() =>
      expect(fixture.data.workouts[0].exercises[0].exerciseId).toBe(replacement.id),
    );
    expect(fixture.data.routines).toEqual(routineBefore);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('table', { name: /sets/i })).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Notes (optional)'));
    expect(screen.getByRole('textbox', { name: /Exercise note/ })).toHaveProperty('value', '');
    expect(
      within(screen.getByRole('group', { name: 'Exercise difficulty' }))
        .getByRole('button', { name: 'Hard' })
        .getAttribute('aria-pressed'),
    ).toBe('false');
    expect(fixture.data.workouts[0].exercises[0].notes).toBeUndefined();
  });

  it('adds a working set from beneath the table without changing the saved routine', async () => {
    await beginWorkout();
    const routineBefore = structuredClone(fixture.data.routines);
    fireEvent.click(screen.getByRole('button', { name: 'Add set' }));
    await waitFor(() =>
      expect(
        fixture.data.workouts[0].exercises[0].actualSets.filter(
          (set: any) => set.kind === 'working',
        ),
      ).toHaveLength(4),
    );
    expect(fixture.data.routines).toEqual(routineBefore);
    expect(screen.getByRole('textbox', { name: 'Set 4 load' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add set' })).toBeTruthy();
  });

  it('opens an expanded own-workout summary from history with every exercise visible', () => {
    const started = startWorkoutDomain(fixture.data, fixture.data.routines[0].id);
    const workout = started.workouts[0];
    const exercise = workout.exercises[0];
    fixture.data = {
      ...started,
      workouts: [
        {
          ...workout,
          status: 'finished',
          completedAt: new Date().toISOString(),
          exercises: [
            {
              ...exercise,
              actualSets: exercise.actualSets.map((s) => ({ ...s, status: 'completed' })),
            },
            {
              ...exercise,
              id: 'second-instance',
              name: 'Synthetic second exercise',
              actualSets: exercise.actualSets.map((s) => ({ ...s, status: 'completed' })),
            },
          ],
        },
      ],
    };
    render(<App />);
    expect(screen.getByRole('navigation', { name: 'Main navigation' }).textContent).toContain(
      'Community',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Progress' }));
    fireEvent.click(screen.getByRole('button', { name: /Workout history/ }));
    fireEvent.click(screen.getByRole('button', { name: workout.name }));
    expect(screen.getAllByRole('table', { name: /completed sets/ })).toHaveLength(2);
    expect(screen.getByRole('heading', { name: 'Synthetic second exercise' })).toBeTruthy();
    expect(document.querySelector('.summary-exercise details')).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Done' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Type' })).toBeNull();
    expect(screen.getByText('Finished')).toBeTruthy();
    expect(screen.getByText('Duration')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Repeat' })).toHaveLength(1);
  });

  it('keeps Progress focused on calendar and weekly working sets with secondary stats and history', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 18, 12));
    const started = startWorkoutDomain(fixture.data, fixture.data.routines[0].id);
    const workout = started.workouts[0];
    const sessions = [11, 12, 19].map((day) => ({
      ...workout,
      id: `synthetic-session-${day}`,
      status: 'finished' as const,
      startedAt: new Date(2026, 9, day, 12).toISOString(),
      trainingDate: '2026-10-' + day,
      completedAt: new Date(2026, 9, day, 13).toISOString(),
      exercises: workout.exercises.map((exercise) => ({
        ...exercise,
        actualSets: exercise.actualSets.map((set, index) => ({
          ...set,
          kind: index === 1 ? ('warmup' as const) : ('working' as const),
          status: index === 2 ? ('skipped' as const) : ('completed' as const),
        })),
      })),
    }));
    fixture.data = { ...started, workouts: [...sessions, workout] };
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Progress' }));
    expect(screen.getByRole('region', { name: 'Workout calendar' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Weekly volume' })).toBeTruthy();
    const volume = screen.getByRole('img', { name: /Completed working sets per week/ });
    expect(volume.getAttribute('aria-label')).toContain('10/5: 1, 10/12: 1');
    expect(screen.queryByRole('button', { name: 'Repeat' })).toBeNull();
    expect(screen.queryByLabelText('Choose an exercise')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Exercise stats/ }));
    expect(screen.getByLabelText('Choose an exercise')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Weekly volume' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Back to Progress/ }));
    fireEvent.click(screen.getByRole('button', { name: /Workout history/ }));
    expect(screen.getAllByRole('button', { name: 'Repeat' })).toHaveLength(3);
    expect(screen.getByRole('heading', { name: 'Workout history', level: 1 })).toBeTruthy();
  });

  it('retains an unsaved history load for retry after a durable write fails', async () => {
    const routine = fixture.data.routines[0];
    fixture.data = startWorkoutDomain(fixture.data, routine.id);
    fixture.data.workouts[0] = {
      ...fixture.data.workouts[0],
      status: 'finished',
      completedAt: new Date().toISOString(),
    };
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Progress' }));
    fireEvent.click(screen.getByRole('button', { name: /Workout history/ }));
    fireEvent.click(screen.getByRole('button', { name: fixture.data.workouts[0].name }));
    fireEvent.click(
      screen.getByRole('button', { name: fixture.data.workouts[0].exercises[0].name }),
    );
    fixture.update.mockRejectedValueOnce(new Error('Synthetic storage failure'));
    const load = screen.getByRole('textbox', { name: 'Set 1 load' });
    fireEvent.change(load, { target: { value: '120' } });
    fireEvent.blur(load);
    await screen.findByText('Synthetic storage failure');
    expect(fixture.data.workouts[0].exercises[0].actualSets[0].weight).toBe(45);
    expect(load).toHaveProperty('value', '120');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Set 1 done' }));
    await waitFor(() =>
      expect(fixture.data.workouts[0].exercises[0].actualSets[0].status).toBe('completed'),
    );
    expect(fixture.data.workouts[0].exercises[0].actualSets[0].weight).toBe(120);
    expect(fixture.data.workouts[0].restEndsAt).toBeUndefined();
  });
  it('ignores a stale active Done event queued after Finish', async () => {
    await beginWorkout();
    const lateDone = screen.getByRole('checkbox', { name: 'Set 1 done' });
    fireEvent.click(screen.getByRole('button', { name: 'Finish workout' }));
    fireEvent.click(lateDone);
    await screen.findByRole('dialog', { name: 'Workout saved' });
    expect(fixture.data.workouts[0].status).toBe('finished');
    expect(fixture.data.workouts[0].exercises[0].actualSets[0].status).toBe('incomplete');
    expect(fixture.data.workouts[0].restEndsAt).toBeUndefined();
  });
  it('shows every set in the four-column table and one top Finish workout action', async () => {
    await beginWorkout();
    expect(screen.getByRole('columnheader', { name: 'Set' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Total load (lb)' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Reps' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Done' })).toBeTruthy();
    expect(screen.getAllByRole('row')).toHaveLength(5);
    expect(screen.getByRole('button', { name: 'Add set' })).toBeTruthy();
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: 'Finish workout' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Discard workout' })).toBeTruthy();
    expect(screen.queryByText('Complete set')).toBeNull();
    expect(screen.queryByRole('combobox', { name: /status/i })).toBeNull();
  });

  it('confirms before discarding an active workout and does not add it to history', async () => {
    await beginWorkout();
    fireEvent.click(screen.getByRole('button', { name: 'Discard workout' }));

    const confirmation = screen.getByRole('dialog', { name: 'Discard this workout?' });
    expect(confirmation.textContent).toContain(
      'Nothing from this workout will be saved to history',
    );
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Keep workout' }));
    expect(fixture.data.workouts).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Discard workout' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Discard this workout?' })).getByRole('button', {
        name: 'Discard workout',
      }),
    );
    await waitFor(() => expect(fixture.data.workouts).toHaveLength(0));
    expect(screen.queryByRole('dialog', { name: 'Workout saved' })).toBeNull();
    expect(screen.getByText('Workout discarded')).toBeTruthy();
  });

  it('keeps the active workout and confirmation open when discard cannot be saved', async () => {
    await beginWorkout();
    fireEvent.click(screen.getByRole('button', { name: 'Discard workout' }));
    fixture.update.mockRejectedValueOnce(new Error('Synthetic storage failure'));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Discard this workout?' })).getByRole('button', {
        name: 'Discard workout',
      }),
    );

    await screen.findByText('Synthetic storage failure');
    expect(fixture.data.workouts).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: 'Discard this workout?' })).toBeTruthy();
  });

  it('opens replacement directly without an exercise Options menu', async () => {
    await beginWorkout();
    expect(screen.queryByRole('button', { name: 'Options' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Replace exercise' }));
    expect(screen.getByRole('searchbox', { name: 'Search replacement exercises' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('button', { name: 'Previous' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next' })).toBeTruthy();
  });

  it('counts elapsed workout seconds from its saved start time and recovers after remount', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));
    fixture.data = startWorkoutDomain(fixture.data, fixture.data.routines[0].id);
    fixture.data.workouts[0].startedAt = '2026-10-20T11:58:55Z';
    const view = render(<App />);
    expect(screen.getByRole('timer', { name: 'Workout elapsed time' }).textContent).toBe('1:05');
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByRole('timer', { name: 'Workout elapsed time' }).textContent).toBe('1:06');
    view.unmount();
    vi.setSystemTime(new Date('2026-10-20T12:01:05Z'));
    render(<App />);
    expect(screen.getByRole('timer', { name: 'Workout elapsed time' }).textContent).toBe('2:10');
  });

  it('captures each serialized pre-change snapshot so Undo restores only the latest tap', async () => {
    await beginWorkout();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Set 1 done' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Set 2 done' }));
    await waitFor(() =>
      expect(fixture.data.workouts[0].exercises[0].actualSets[1].status).toBe('completed'),
    );
    fireEvent.click(screen.getByRole('button', { name: /Undo/ }));
    await waitFor(() => {
      expect(fixture.data.workouts[0].exercises[0].actualSets[0].status).toBe('completed');
      expect(fixture.data.workouts[0].exercises[0].actualSets[1].status).toBe('incomplete');
      expect(fixture.data.workouts[0].restSetId).toBe(
        fixture.data.workouts[0].exercises[0].actualSets[0].id,
      );
    });
  });

  it('keeps invalid numeric drafts local and commits decimal load and integer reps before Done', async () => {
    await beginWorkout();
    const load = screen.getByRole('textbox', { name: 'Set 1 load' });
    const reps = screen.getByRole('textbox', { name: 'Set 1 reps' });
    fireEvent.change(load, { target: { value: '100.5' } });
    fireEvent.change(reps, { target: { value: '9' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Set 1 done' }));
    await waitFor(() =>
      expect(fixture.data.workouts[0].exercises[0].actualSets[0].status).toBe('completed'),
    );
    expect(fixture.data.workouts[0].exercises[0].actualSets[0].weight).toBe(100.5);
    expect(fixture.data.workouts[0].exercises[0].actualSets[0].reps).toBe(9);
  });

  it('does not complete a row when a load draft is outside the accepted range', async () => {
    await beginWorkout();
    fireEvent.change(screen.getByRole('textbox', { name: 'Set 1 load' }), {
      target: { value: '9999' },
    });
    const done = screen.getByRole('checkbox', { name: 'Set 1 done' });
    expect(done).toHaveProperty('disabled', true);
    expect(screen.getByRole('textbox', { name: 'Set 1 load' }).getAttribute('aria-invalid')).toBe(
      'true',
    );
    expect(fixture.data.workouts[0].exercises[0].actualSets[0].status).toBe('incomplete');
  });

  it('uses the serialized completion state for the immediate Finish workout summary', async () => {
    await beginWorkout();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Set 1 done' }));
    fireEvent.click(screen.getByRole('button', { name: 'Finish workout' }));
    await screen.findByRole('dialog', { name: 'Workout saved' });
    expect(screen.getByRole('dialog', { name: 'Workout saved' }).textContent).toContain('1 sets');
    await waitFor(() =>
      expect(fixture.data.workouts[0].exercises[0].actualSets[0].status).toBe('completed'),
    );
  });

  it('allows a history Done correction without starting rest or calling Coach', async () => {
    const routine = fixture.data.routines[0];
    const started = startWorkoutDomain(fixture.data, routine.id);
    const activeWorkout = started.workouts[0];
    const finishedWorkout = {
      ...activeWorkout,
      status: 'finished' as const,
      completedAt: new Date().toISOString(),
      exercises: activeWorkout.exercises.map((exercise, index) =>
        index === 0
          ? {
              ...exercise,
              actualSets: exercise.actualSets.map((set, setIndex) =>
                setIndex === 0
                  ? { ...set, status: 'completed' as const, completedAt: new Date().toISOString() }
                  : set,
              ),
            }
          : exercise,
      ),
    };
    fixture.data = { ...started, workouts: [finishedWorkout] };
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Progress' }));
    fireEvent.click(screen.getByRole('button', { name: /Workout history/ }));
    fireEvent.click(screen.getByRole('button', { name: finishedWorkout.name }));
    fireEvent.click(screen.getByRole('button', { name: finishedWorkout.exercises[0].name }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Set 1 done' }));
    await waitFor(() =>
      expect(fixture.data.workouts[0].exercises[0].actualSets[0].status).toBe('incomplete'),
    );
    expect(fixture.data.workouts[0].restEndsAt).toBeUndefined();
    expect(fixture.data.workouts[0].restSetId).toBeUndefined();
    expect(fixture.data.messages).toHaveLength(0);
  });
});
