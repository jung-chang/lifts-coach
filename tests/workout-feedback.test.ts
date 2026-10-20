import { describe, expect, it } from 'vitest';
import { catalog } from '../shared/catalog';
import {
  completeSet,
  createPrescription,
  createRoutine,
  emptyData,
  finishWorkout,
  previousExerciseNote,
  previousWorkoutNote,
  repeatWorkout,
  startWorkout,
  updateWorkoutFeedback,
  validateBackup,
} from '../shared/domain';

function setup() {
  const routine = {
    ...createRoutine('Synthetic routine'),
    exercises: [createPrescription(catalog[0].id)],
  };
  return startWorkout({ ...emptyData(), routines: [routine] }, routine.id);
}

describe('session feedback', () => {
  it('shows nothing when the previous session has no manually written note, even if an older one does', () => {
    let data = setup();
    const first = data.workouts[0],
      ex = first.exercises[0];
    data = completeSet(data, first.id, ex.id, ex.actualSets[0].id);
    data = updateWorkoutFeedback(data, first.id, { notes: 'Synthetic older exercise note' }, ex.id);
    data = updateWorkoutFeedback(data, first.id, { notes: 'Synthetic older workout note' });
    data = finishWorkout(data, first.id);
    data.workouts[0].startedAt = '2026-01-01T12:00:00Z';
    data = startWorkout(data, data.routines[0].id);
    const previous = data.workouts[1];
    data = completeSet(
      data,
      previous.id,
      previous.exercises[0].id,
      previous.exercises[0].actualSets[0].id,
    );
    data = updateWorkoutFeedback(data, previous.id, { notes: '   ' }, previous.exercises[0].id);
    data = finishWorkout(data, previous.id);
    data.workouts[1].startedAt = '2026-01-08T12:00:00Z';
    data = startWorkout(data, data.routines[0].id);
    const current = data.workouts[2];
    expect(previousExerciseNote(data, current.id, current.exercises[0].id)).toBeUndefined();
    expect(previousWorkoutNote(data, current.id)).toBeUndefined();
    data = updateWorkoutFeedback(
      data,
      previous.id,
      { notes: 'Synthetic manually written note' },
      previous.exercises[0].id,
    );
    expect(previousExerciseNote(data, current.id, current.exercises[0].id)?.notes).toBe(
      'Synthetic manually written note',
    );
  });

  it('keeps entries per session, preserves them on finish and starts repeat feedback blank', () => {
    let data = setup();
    const workout = data.workouts[0],
      exercise = workout.exercises[0];
    const routines = structuredClone(data.routines);
    data = updateWorkoutFeedback(
      data,
      workout.id,
      { notes: 'Synthetic exercise note', feeling: 'hard', repsInReserve: '0' },
      exercise.id,
    );
    data = updateWorkoutFeedback(data, workout.id, { notes: 'Synthetic workout note' });
    data = completeSet(data, workout.id, exercise.id, exercise.actualSets[0].id);
    data = finishWorkout(data, workout.id);
    const saved = structuredClone(data.workouts[0]);
    data = repeatWorkout(data, workout.id);
    const repeated = data.workouts[1];
    expect(repeated.notes).toBeUndefined();
    expect(repeated.exercises[0].notes).toBeUndefined();
    expect(repeated.exercises[0].feeling).toBeUndefined();
    expect(repeated.exercises[0].repsInReserve).toBeUndefined();
    expect(previousExerciseNote(data, repeated.id, repeated.exercises[0].id)?.notes).toBe(
      'Synthetic exercise note',
    );
    expect(previousWorkoutNote(data, repeated.id)?.notes).toBe('Synthetic workout note');
    data = updateWorkoutFeedback(
      data,
      repeated.id,
      { notes: 'New entry', feeling: 'easy' },
      repeated.exercises[0].id,
    );
    expect(data.workouts[0]).toEqual(saved);
    expect(data.routines).toEqual(routines);
    expect(saved.notes).toBe('Synthetic workout note');
    expect(saved.exercises[0].feeling).toBe('hard');
    expect(saved.exercises[0].repsInReserve).toBe('0');
    expect(validateBackup(JSON.parse(JSON.stringify(data)))).toEqual(
      JSON.parse(JSON.stringify(data)),
    );
  });

  it('finds the last performed exercise note across routines, ignoring unperformed and future sessions', () => {
    let data = setup();
    const old = data.workouts[0],
      ex = old.exercises[0];
    data = completeSet(data, old.id, ex.id, ex.actualSets[0].id);
    data = updateWorkoutFeedback(data, old.id, { notes: 'Prior performed note' }, ex.id);
    data = finishWorkout(data, old.id);
    data = startWorkout(data, data.routines[0].id);
    const current = data.workouts[1];
    data.workouts[0].startedAt = '2026-01-01T00:00:00Z';
    data.workouts[0].routineId = 'another-routine';
    data.workouts.push({
      ...structuredClone(data.workouts[0]),
      id: 'later-unperformed',
      startedAt: '2026-01-02T00:00:00Z',
      exercises: [{ ...ex, notes: 'Not performed' }],
    });
    data.workouts.push({
      ...structuredClone(data.workouts[0]),
      id: 'future',
      startedAt: '2099-01-01T00:00:00Z',
    });
    expect(previousExerciseNote(data, current.id, current.exercises[0].id)?.notes).toBe(
      'Prior performed note',
    );
    expect(previousWorkoutNote(data, current.id)).toBeUndefined();
  });

  it('allows clearing entries and rejects invalid feedback in mutations and backups', () => {
    let data = setup();
    const workout = data.workouts[0],
      ex = workout.exercises[0];
    data = updateWorkoutFeedback(data, workout.id, { notes: 'Draft', feeling: 'good' }, ex.id);
    data = updateWorkoutFeedback(data, workout.id, { notes: '', feeling: undefined }, ex.id);
    expect(data.workouts[0].exercises[0].notes).toBe('');
    expect(data.workouts[0].exercises[0].feeling).toBeUndefined();
    data = updateWorkoutFeedback(data, workout.id, { repsInReserve: '1-2' }, ex.id);
    expect(data.workouts[0].exercises[0].repsInReserve).toBe('1-2');
    data = updateWorkoutFeedback(data, workout.id, { repsInReserve: undefined }, ex.id);
    expect(data.workouts[0].exercises[0].repsInReserve).toBeUndefined();
    expect(() => updateWorkoutFeedback(data, workout.id, { repsInReserve: '0' })).toThrow();
    const invalidEffort = structuredClone(data);
    (invalidEffort.workouts[0].exercises[0] as any).repsInReserve = 'invalid';
    expect(() => validateBackup(invalidEffort)).toThrow();
    expect(() => updateWorkoutFeedback(data, workout.id, { feeling: 'invalid' }, ex.id)).toThrow();
    expect(() =>
      updateWorkoutFeedback(data, workout.id, { notes: 'Wrong target' }, 'missing'),
    ).toThrow();
    const invalid = structuredClone(data);
    (invalid.workouts[0].exercises[0] as any).feeling = 'invalid';
    expect(() => validateBackup(invalid)).toThrow();
    (invalid.workouts[0].exercises[0] as any).feeling = undefined;
    (invalid.workouts[0] as any).notes = {};
    expect(() => validateBackup(invalid)).toThrow();
  });
});
