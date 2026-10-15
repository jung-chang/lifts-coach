import { describe, expect, it } from 'vitest';
import { emptyData } from '../shared/domain';
import { addSampleRoutine, createSampleRoutine } from '../src/lib/sampleRoutine';

describe('sample routine', () => {
  it('creates a compact built-in routine without synthetic history', () => {
    const routine = createSampleRoutine(2);
    expect(routine.name).toBe('Full-body starter');
    expect(routine.position).toBe(2);
    expect(routine.exercises.map((exercise) => exercise.exerciseId)).toEqual([
      'ex_back-squat',
      'ex_barbell-bench-press',
      'ex_seated-cable-row',
      'ex_dumbbell-rdl',
    ]);
    expect(routine.exercises.every((exercise) => exercise.targetWeight === 0)).toBe(true);
  });

  it('adds the sample as the next routine without changing workout history', () => {
    const data = emptyData();
    const next = addSampleRoutine(data);
    expect(next.routines).toHaveLength(1);
    expect(next.workouts).toEqual([]);
    expect(next.settings.rotationIndex).toBe(0);
  });
});
