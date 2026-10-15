import { catalog } from '../../shared/catalog';
import { createPrescription, createRoutine } from '../../shared/domain';
import type { AppData, Routine } from '../../shared/types';

const samplePlan = [
  ['ex_back-squat', 3, [6, 8], 120],
  ['ex_barbell-bench-press', 3, [6, 8], 120],
  ['ex_seated-cable-row', 3, [8, 12], 90],
  ['ex_dumbbell-rdl', 3, [8, 12], 120],
] as const;

export function createSampleRoutine(position: number): Routine {
  const routine = createRoutine('Full-body starter', position);
  routine.exercises = samplePlan.map(([exerciseId, sets, repRange, restSeconds]) => {
    if (!catalog.some((exercise) => exercise.id === exerciseId))
      throw new Error(`Sample exercise is unavailable: ${exerciseId}`);
    return {
      ...createPrescription(exerciseId),
      sets,
      repRange: [...repRange] as [number, number],
      restSeconds,
    };
  });
  return routine;
}

export function addSampleRoutine(data: AppData): AppData {
  const routine = createSampleRoutine(data.routines.length);
  return {
    ...data,
    routines: [...data.routines, routine],
    settings: { ...data.settings, rotationIndex: data.routines.length },
  };
}
