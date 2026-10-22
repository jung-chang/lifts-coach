// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { catalog } from '../shared/catalog';
import { createPrescription } from '../shared/domain';
import type { Workout } from '../shared/types';
import { WorkoutSummary } from '../src/components/WorkoutSummary';
import { historyItemsFromWorkouts } from '../src/components/TrainingHistory';

afterEach(cleanup);

it('shows completed performance in the recorded timezone and preserves owner actions and feedback', () => {
  const updatedAt = '2026-10-18T15:00:00Z';
  const exercise = {
    ...createPrescription(catalog[0].id),
    name: 'Synthetic dumbbell press',
    notes: 'Synthetic private exercise note',
    actualSets: [
      {
        id: 'warmup',
        weight: 25,
        reps: 12,
        kind: 'warmup' as const,
        status: 'completed' as const,
        loadMode: 'per-dumbbell' as const,
        updatedAt,
      },
      {
        id: 'working',
        weight: 50,
        reps: 8,
        kind: 'working' as const,
        status: 'completed' as const,
        loadMode: 'per-dumbbell' as const,
        updatedAt,
      },
      {
        id: 'skipped',
        weight: 60,
        reps: 6,
        kind: 'working' as const,
        status: 'skipped' as const,
        loadMode: 'per-dumbbell' as const,
        updatedAt,
      },
      {
        id: 'incomplete',
        weight: 70,
        reps: 5,
        kind: 'working' as const,
        status: 'incomplete' as const,
        loadMode: 'per-dumbbell' as const,
        updatedAt,
      },
    ],
  };
  const workout: Workout = {
    id: 'synthetic-summary',
    name: 'Synthetic upper body',
    status: 'finished',
    updatedAt,
    startedAt: '2026-10-18T14:20:01Z',
    completedAt: updatedAt,
    trainingTimezone: 'America/New_York',
    exercises: [exercise],
    notes: 'Synthetic private workout note',
  };
  const original = structuredClone(workout);
  const onRepeat = vi.fn();
  const onCorrection = vi.fn();
  render(
    <WorkoutSummary
      workout={workout}
      unit="lb"
      session={null}
      synced={false}
      onBack={() => {}}
      onRepeat={onRepeat}
      onCorrection={onCorrection}
    />,
  );
  const table = screen.getByRole('table', { name: /completed sets/ });
  expect(within(table).getAllByRole('row')).toHaveLength(3);
  expect(within(table).getByText('Warm-up 1')).toBeTruthy();
  expect(within(table).getByText('50 lb each')).toBeTruthy();
  expect(within(table).queryByText('60 lb each')).toBeNull();
  expect(within(table).queryByText('70 lb each')).toBeNull();
  expect(
    within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent),
  ).toEqual(['Set', 'Load', 'Reps']);
  expect(screen.getByRole('heading', { level: 2, name: exercise.name })).toBeTruthy();
  expect(screen.getByText(/2 skipped or incomplete sets/)).toBeTruthy();
  expect(screen.getByText(exercise.notes)).toBeTruthy();
  expect(screen.getByText(workout.notes!)).toBeTruthy();
  const finishTime = document.querySelector('time')!;
  expect(finishTime.getAttribute('datetime')).toBe(updatedAt);
  expect(finishTime.textContent).toContain(
    new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: workout.trainingTimezone,
    }).format(new Date(updatedAt)),
  );
  expect(finishTime.textContent).toContain('America/New York');
  expect(
    screen.getByText(`${historyItemsFromWorkouts([workout])[0].durationMinutes} min`),
  ).toBeTruthy();
  const count = screen.getByText('Working sets').nextElementSibling;
  expect(count?.textContent).toBe('1');
  fireEvent.click(screen.getByRole('button', { name: 'Repeat' }));
  expect(onRepeat).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: exercise.name }));
  expect(onCorrection).toHaveBeenCalledWith(exercise);
  expect(workout).toEqual(original);
});
