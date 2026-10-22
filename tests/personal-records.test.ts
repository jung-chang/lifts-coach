import { expect, it } from 'vitest';
import { catalog } from '../shared/catalog';
import { createPrescription } from '../shared/domain';
import { personalRecordsFromWorkouts, recordKey } from '../shared/personalRecords';
import type { Exercise, Workout, WorkoutExercise, WorkoutSet } from '../shared/types';

function workout(
  id: string,
  date: string,
  exerciseRows: Array<{ exerciseId: string; sets: Array<Partial<WorkoutSet> & { id: string }> }>,
  status: Workout['status'] = 'finished',
): Workout {
  const exercises = exerciseRows.map(({ exerciseId, sets }) => {
    const definition = catalog.find((item) => item.id === exerciseId) ?? {
      id: exerciseId,
      name: exerciseId,
      muscles: [],
      equipment: 'Unknown',
      instructions: '',
      loadMode: 'external' as const,
      region: 'full' as const,
    };
    const base = catalog.some((item) => item.id === exerciseId)
      ? createPrescription(exerciseId)
      : {
          id: `prescription-${exerciseId}`,
          exerciseId,
          sets: 3,
          repRange: [8, 12] as [number, number],
          targetWeight: 0,
          restSeconds: 90,
          loadMode: definition.loadMode,
        };
    const instance: WorkoutExercise = {
      ...base,
      id: `instance-${id}-${exerciseId}`,
      name: definition.name,
      actualSets: [],
    };
    instance.actualSets = sets.map((set) => ({
      id: set.id,
      weight: set.weight ?? 0,
      reps: set.reps ?? 8,
      kind: set.kind ?? 'working',
      status: set.status ?? 'completed',
      updatedAt: date,
      loadMode: set.loadMode ?? definition.loadMode,
    }));
    return instance;
  });
  return {
    id,
    name: id,
    startedAt: date,
    completedAt: status === 'finished' ? date : undefined,
    status,
    exercises,
    updatedAt: date,
  };
}

it('records baseline and later load improvements, ignores rep-only gains and keeps historical achievements', () => {
  const id = catalog.find((item) => item.name === 'Barbell bench press')!.id;
  const history = [
    workout('a', '2025-01-01', [{ exerciseId: id, sets: [{ id: 's1', weight: 100, reps: 5 }] }]),
    workout('b', '2025-02-01', [{ exerciseId: id, sets: [{ id: 's2', weight: 100, reps: 12 }] }]),
    workout('c', '2025-03-01', [{ exerciseId: id, sets: [{ id: 's3', weight: 105, reps: 4 }] }]),
    workout('d', '2025-04-01', [{ exerciseId: id, sets: [{ id: 's4', weight: 110, reps: 1 }] }]),
  ];
  const result = personalRecordsFromWorkouts(history);
  expect(result.best[0]).toMatchObject({ workoutId: 'd', weight: 110, reps: 1, setId: 's4' });
  expect(result.achievements.map((record) => record.workoutId)).toEqual(['c', 'd']);
});

it('inverts assistance records, uses actual mode and stable ties, and collapses duplicate instances per workout', () => {
  const assisted = catalog.find((item) => item.equipment === 'Assisted machine')!;
  const history = [
    workout('first', '2025-01-01', [
      { exerciseId: assisted.id, sets: [{ id: 'more', loadMode: 'assistance', weight: 70 }] },
      { exerciseId: assisted.id, sets: [{ id: 'tie-later', loadMode: 'assistance', weight: 70 }] },
    ]),
    workout('second', '2025-02-01', [
      { exerciseId: assisted.id, sets: [{ id: 'less', loadMode: 'assistance', weight: 40 }] },
    ]),
  ];
  const result = personalRecordsFromWorkouts(history);
  expect(result.best[0]).toMatchObject({ workoutId: 'second', weight: 40 });
  expect(result.achievements).toHaveLength(1);
  const tie = personalRecordsFromWorkouts([history[0]]);
  expect(tie.best[0].setId).toBe('more');
});

it('filters unperformed sets, active workouts, warmups, zero reps, invalid weights and pure bodyweight', () => {
  const bench = catalog.find((item) => item.name === 'Barbell bench press')!;
  const pushup = catalog.find((item) => item.id === 'ex_push-up')!;
  const result = personalRecordsFromWorkouts([
    workout(
      'active',
      '2025-01-01',
      [{ exerciseId: bench.id, sets: [{ id: 'active-set', weight: 300 }] }],
      'active',
    ),
    workout('done', '2025-02-01', [
      {
        exerciseId: bench.id,
        sets: [
          { id: 'warmup', kind: 'warmup', weight: 400 },
          { id: 'skip', status: 'skipped', weight: 500 },
          { id: 'zero-reps', reps: 0, weight: 600 },
          { id: 'negative', weight: -1 },
          { id: 'pure', weight: 0 },
        ],
      },
      { exerciseId: pushup.id, sets: [{ id: 'bodyweight', weight: 0, loadMode: 'bodyweight' }] },
    ]),
  ]);
  expect(result).toEqual({ best: [], achievements: [] });
});

it('accepts added bodyweight only for rep exercises and applies curated exclusions', () => {
  const pushup = catalog.find((item) => item.id === 'ex_push-up')!;
  const planner = catalog[0];
  const bandExercise: Exercise = {
    ...planner,
    id: 'custom-band',
    equipment: 'Resistance band',
    custom: true,
  };
  const carry: Exercise = { ...planner, id: 'ex_farmers-carry', equipment: 'Dumbbells' };
  const custom: Exercise = { ...planner, id: 'custom-lift', name: 'Custom lift', custom: true };
  const result = personalRecordsFromWorkouts(
    [
      workout('one', '2025-01-01', [
        { exerciseId: pushup.id, sets: [{ id: 'added', weight: 20, loadMode: 'bodyweight' }] },
        { exerciseId: bandExercise.id, sets: [{ id: 'band', weight: 100 }] },
        { exerciseId: carry.id, sets: [{ id: 'carry', weight: 100 }] },
        { exerciseId: custom.id, sets: [{ id: 'custom', weight: 80 }] },
        { exerciseId: 'unknown', sets: [{ id: 'unknown', weight: 999 }] },
      ]),
    ],
    [bandExercise, carry, custom],
  );
  expect(result.best.map((record) => record.exerciseId).sort()).toEqual(
    [pushup.id, custom.id].sort(),
  );
});

it('handles deterministic workout order, corrections, removal, old history, and conversion precision', () => {
  const id = catalog[0].id;
  const old = workout('old', '2010-01-01', [
    { exerciseId: id, sets: [{ id: 'old-set', weight: 200, reps: 2 }] },
  ]);
  const tieA = workout('a', '2025-01-01', [
    { exerciseId: id, sets: [{ id: 'a-set', weight: 201, reps: 2 }] },
  ]);
  const tieB = workout('b', '2025-01-01', [
    { exerciseId: id, sets: [{ id: 'b-set', weight: 201.0000002, reps: 12 }] },
  ]);
  const recent = workout('recent', '2025-02-01', [
    { exerciseId: id, sets: [{ id: 'recent-set', weight: 210, reps: 1 }] },
  ]);
  const first = personalRecordsFromWorkouts([recent, tieB, old, tieA]);
  expect(first.best[0].workoutId).toBe('recent');
  expect(first.achievements.map((record) => record.workoutId)).toEqual(['a', 'recent']);
  expect(personalRecordsFromWorkouts([old, tieA]).best[0].workoutId).toBe('a');
  expect(recordKey(id, 'external')).not.toBe(recordKey(id, 'per-dumbbell'));
});

it('ignores incomplete and NaN sets while accepting zero assistance and separating dumbbell modes', () => {
  const id = catalog.find((exercise) => exercise.equipment === 'Assisted machine')!.id;
  const result = personalRecordsFromWorkouts([
    workout('mixed', '2025-01-01', [
      {
        exerciseId: id,
        sets: [
          { id: 'incomplete', status: 'incomplete', weight: 500 },
          { id: 'nan', weight: Number.NaN },
          { id: 'external', weight: 100, loadMode: 'external' },
          { id: 'dumbbell', weight: 50, loadMode: 'per-dumbbell' },
          { id: 'zero-assistance', weight: 0, loadMode: 'assistance' },
        ],
      },
    ]),
  ]);
  expect(result.best).toHaveLength(3);
  expect(result.best.find((record) => record.loadMode === 'external')?.weight).toBe(100);
  expect(result.best.find((record) => record.loadMode === 'per-dumbbell')?.weight).toBe(50);
  expect(result.best.find((record) => record.loadMode === 'assistance')?.weight).toBe(0);
});

it('retains the best across more than eight workouts and recalculates after edits and removals', () => {
  const id = catalog[0].id;
  const history = Array.from({ length: 11 }, (_, index) =>
    workout(`workout-${index}`, `2025-${String(index + 1).padStart(2, '0')}-01`, [
      {
        exerciseId: id,
        sets: [{ id: `set-${index}`, weight: index === 0 ? 200 : 100 + index, reps: 6 }],
      },
    ]),
  );
  const result = personalRecordsFromWorkouts(history);
  expect(result.best[0]).toMatchObject({ workoutId: 'workout-0', weight: 200 });
  expect(result.achievements).toHaveLength(0);

  const prior = workout('baseline', '2024-01-01', [
    { exerciseId: id, sets: [{ id: 'base-set', weight: 100 }] },
  ]);
  const later = workout('later', '2024-02-01', [
    { exerciseId: id, sets: [{ id: 'later-set', weight: 120 }] },
  ]);
  expect(
    personalRecordsFromWorkouts([prior, later]).achievements.map((record) => record.workoutId),
  ).toEqual(['later']);
  later.exercises[0].actualSets[0].weight = 90;
  expect(personalRecordsFromWorkouts([prior, later])).toMatchObject({
    best: [{ workoutId: 'baseline', weight: 100 }],
    achievements: [],
  });
  expect(personalRecordsFromWorkouts([later]).achievements).toEqual([]); // deleting the baseline makes the survivor a baseline
});

it('isolates separate users, filters custom timed or suspension-supported movements, and sorts offset timestamps', () => {
  const base = catalog[0];
  const timed: Exercise = { ...base, id: 'custom-hold', name: 'Weighted hold', custom: true };
  const suspension: Exercise = {
    ...base,
    id: 'custom-suspension',
    name: 'Suspension row',
    equipment: 'Suspension trainer',
    custom: true,
  };
  const firstUser = workout('u1', '2025-01-01T01:00:00+02:00', [
    { exerciseId: base.id, sets: [{ id: 'u1-set', weight: 120 }] },
    { exerciseId: timed.id, sets: [{ id: 'hold-set', weight: 500 }] },
    { exerciseId: suspension.id, sets: [{ id: 'susp-set', weight: 500 }] },
  ]);
  const earlierUtc = workout('earlier', '2024-12-31T22:30:00Z', [
    { exerciseId: base.id, sets: [{ id: 'earlier-set', weight: 110 }] },
  ]);
  const firstResult = personalRecordsFromWorkouts([firstUser, earlierUtc], [timed, suspension]);
  expect(firstResult.best).toHaveLength(1);
  expect(firstResult.best[0].workoutId).toBe('u1');
  expect(firstResult.achievements).toHaveLength(1);

  const secondUser = workout('u2', '2025-01-02', [
    { exerciseId: base.id, sets: [{ id: 'u2-set', weight: 80 }] },
  ]);
  expect(personalRecordsFromWorkouts([secondUser]).best[0].weight).toBe(80);
  expect(personalRecordsFromWorkouts([secondUser]).achievements).toEqual([]);
});
