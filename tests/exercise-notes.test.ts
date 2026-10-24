import { describe, expect, it } from 'vitest';
import {
  createPrescription,
  editWorkout,
  emptyData,
  finishWorkout,
  repeatWorkout,
  startWorkout,
  updatePersistentExerciseNote,
  validateBackup,
} from '../shared/domain';
import { catalog } from '../shared/catalog';
import type { AppData } from '../shared/types';

const stamp = '2026-10-23T12:00:00.000Z';
const routineWith = (id: string, exerciseId: string) => ({
  id,
  name: id,
  position: 0,
  exercises: [{ ...createPrescription(exerciseId), id: `${id}-rx`, sets: 1 }],
  updatedAt: stamp,
});

describe('persistent exercise notes', () => {
  it('shares a note by stable exercise id and snapshots it into future workouts', () => {
    const exerciseId = catalog[0].id;
    const first = routineWith('first', exerciseId);
    const second = routineWith('second', exerciseId);
    let data: AppData = { ...emptyData(), routines: [first, second] };
    data = updatePersistentExerciseNote(data, exerciseId, 'Pause each rep.');
    const firstWorkout = startWorkout(data, first.id);
    expect(firstWorkout.workouts.at(-1)?.exercises[0].persistentNote).toBe('Pause each rep.');
    const done = finishWorkout(
      firstWorkout,
      firstWorkout.workouts.at(-1)!.id,
      'good',
      'Session feedback',
    );
    const changed = updatePersistentExerciseNote(done, exerciseId, 'Use a three second pause.');
    expect(changed.workouts[0].exercises[0].persistentNote).toBe('Pause each rep.');
    expect(changed.workouts[0].notes).toBe('Session feedback');
    expect(startWorkout(changed, second.id).workouts.at(-1)?.exercises[0].persistentNote).toBe(
      'Use a three second pause.',
    );
  });

  it('keeps repeat snapshots, clears session feedback, and updates only explicitly targeted active snapshots', () => {
    const exerciseId = catalog[0].id;
    const routine = routineWith('r', exerciseId);
    let data = updatePersistentExerciseNote(
      { ...emptyData(), routines: [routine] },
      exerciseId,
      'Keep elbows tucked.',
    );
    data = startWorkout(data, routine.id);
    const activeId = data.workouts[0].id;
    const explicitlyUpdated = updatePersistentExerciseNote(
      data,
      exerciseId,
      'Move slowly.',
      activeId,
    );
    expect(explicitlyUpdated.workouts[0].exercises[0].persistentNote).toBe('Move slowly.');
    const finished = finishWorkout(explicitlyUpdated, activeId, 'good', 'Session fatigue');
    const repeated = repeatWorkout(finished, activeId);
    expect(repeated.workouts.at(-1)?.exercises[0].persistentNote).toBe('Move slowly.');
    expect(repeated.workouts.at(-1)?.notes).toBeUndefined();
    expect(repeated.workouts.at(-1)?.exercises[0].notes).toBeUndefined();
    expect(() => updatePersistentExerciseNote(finished, exerciseId, 'Too late.', activeId)).toThrow(
      /active workout/i,
    );
  });

  it('uses the replacement exercise note and snapshots notes on active additions', () => {
    const original = catalog[0],
      replacement = catalog[1];
    const routine = routineWith('r', original.id);
    let data: AppData = {
      ...emptyData(),
      routines: [routine],
      exerciseSettings: {
        [original.id]: { persistentNote: 'Original cue', updatedAt: stamp },
        [replacement.id]: { persistentNote: 'Replacement cue', updatedAt: stamp },
      },
    };
    data = startWorkout(data, routine.id);
    const workoutId = data.workouts[0].id;
    const replacementResult = editWorkout(data, workoutId, [
      {
        op: 'replace_exercise',
        exerciseId: data.workouts[0].exercises[0].id,
        replacementId: replacement.id,
      },
    ]);
    expect(replacementResult.workouts[0].exercises[0].persistentNote).toBe('Replacement cue');
    const added = editWorkout(replacementResult, workoutId, [
      { op: 'add_exercise', exerciseId: original.id, sets: 1, repRange: [8, 12] },
    ]);
    expect(added.workouts[0].exercises[1].persistentNote).toBe('Original cue');
  });

  it('migrates v1 backups, round-trips notes, and rejects invalid settings and snapshots', () => {
    const exerciseId = catalog[0].id;
    const legacy = { ...emptyData(), schemaVersion: 1 as const, exerciseSettings: undefined };
    expect(validateBackup(legacy).schemaVersion).toBe(2);
    expect(validateBackup(legacy).exerciseSettings).toEqual({});
    const routine = routineWith('r', exerciseId);
    const noted = updatePersistentExerciseNote(
      { ...emptyData(), routines: [routine] },
      exerciseId,
      'Brace before each rep.',
    );
    expect(validateBackup(noted).exerciseSettings?.[exerciseId].persistentNote).toBe(
      'Brace before each rep.',
    );
    expect(() =>
      validateBackup({
        ...noted,
        exerciseSettings: { [exerciseId]: { persistentNote: 'x'.repeat(2001), updatedAt: stamp } },
      }),
    ).toThrow(/2000/);
    const active = startWorkout(noted, routine.id);
    expect(() =>
      validateBackup({
        ...active,
        workouts: active.workouts.map((workout) => ({
          ...workout,
          exercises: workout.exercises.map((exercise) => ({
            ...exercise,
            persistentNote: 'x'.repeat(2001),
          })),
        })),
      }),
    ).toThrow(/persistent exercise note/i);
  });
});
