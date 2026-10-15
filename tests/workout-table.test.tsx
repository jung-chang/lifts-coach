// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function beginWorkout() {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Start workout' }));
  await screen.findByRole('table', { name: /sets/i });
}

describe('workout set table', () => {
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
    expect(screen.getByRole('columnheader', { name: 'Load (lb)' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Reps' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Done' })).toBeTruthy();
    expect(screen.getAllByRole('row')).toHaveLength(4);
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: 'Finish workout' })).toHaveLength(1);
    expect(screen.queryByText('Complete set')).toBeNull();
    expect(screen.queryByRole('combobox', { name: /status/i })).toBeNull();
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
