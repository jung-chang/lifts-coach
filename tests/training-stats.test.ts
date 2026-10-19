import { expect, it } from 'vitest';
import { exerciseStatsFromWorkouts } from '../shared/trainingStats';
import { createPrescription, createRoutine, emptyData, startWorkout } from '../shared/domain';
import { catalog } from '../shared/catalog';

it('groups by actual load mode, collapses duplicate exercise instances, and ignores unperformed or warm-up sets', () => {
  const routine = {
    ...createRoutine('Synthetic statistics'),
    exercises: [createPrescription(catalog[0].id)],
  };
  const workout = startWorkout({ ...emptyData(), routines: [routine] }, routine.id).workouts[0];
  workout.status = 'finished';
  workout.completedAt = workout.startedAt;
  const exercise = workout.exercises[0],
    set = exercise.actualSets[0];
  exercise.actualSets = [
    { ...set, id: 'working', status: 'completed', weight: 100, reps: 8 },
    { ...set, id: 'warmup', kind: 'warmup', status: 'completed', weight: 300 },
    { ...set, id: 'skipped', status: 'skipped', weight: 500 },
    { ...set, id: 'assisted', status: 'completed', loadMode: 'assistance', weight: 70, reps: 8 },
    {
      ...set,
      id: 'less-assisted',
      status: 'completed',
      loadMode: 'assistance',
      weight: 40,
      reps: 8,
    },
  ];
  workout.exercises.push({
    ...exercise,
    id: 'second-instance',
    actualSets: [{ ...set, id: 'stronger', status: 'completed', weight: 110, reps: 6 }],
  });
  const stats = exerciseStatsFromWorkouts([workout]);
  expect(stats).toHaveLength(2);
  expect(stats.find((s) => s.loadMode === 'external')?.points).toEqual([
    { date: workout.startedAt, weight: 110, reps: 6 },
  ]);
  expect(stats.find((s) => s.loadMode === 'assistance')?.points).toEqual([
    { date: workout.startedAt, weight: 40, reps: 8 },
  ]);
});
