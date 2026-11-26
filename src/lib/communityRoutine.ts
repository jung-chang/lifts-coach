import { catalog } from '../../shared/catalog';
import type { SharedWorkout } from '../../shared/community';
import { createPrescription, id } from '../../shared/domain';
import type { AppData, Exercise } from '../../shared/types';
import { createRoutineDraft } from './routineDraft';

export function createCommunityRoutineDraft(workout: SharedWorkout, data: AppData) {
  const draft = createRoutineDraft(undefined, undefined, data);
  const customExercises = new Map<string, Exercise>();
  draft.routine.name = workout.title.trim() || 'Community workout';

  for (const exercise of workout.exercises) {
    const workingSets = exercise.sets.filter((set) => set.kind === 'working');
    if (!workingSets.length) continue;
    const first = workingSets.find((set) => set.reps > 0) ?? workingSets[0];
    const loadMode = first.loadMode ?? exercise.loadMode;
    const reps = workingSets
      .filter((set) => set.reps > 0 && (set.loadMode ?? exercise.loadMode) === loadMode)
      .map((set) => Math.min(set.reps, 100));

    let definition =
      catalog.find((entry) => entry.id === exercise.exerciseId) ??
      customExercises.get(exercise.exerciseId);
    if (!definition) {
      definition = {
        id: id('custom'),
        name: exercise.name.trim() || 'Custom exercise',
        muscles: ['Unspecified'],
        equipment: 'Unspecified',
        instructions: 'No instructions provided.',
        loadMode,
        region: 'full',
        custom: true,
      };
      customExercises.set(exercise.exerciseId, definition);
    }

    const prescription = createPrescription(definition.id, [definition]);
    draft.routine.exercises.push({
      ...prescription,
      sets: Math.min(workingSets.length, 30),
      repRange: reps.length ? [Math.min(...reps), Math.max(...reps)] : prescription.repRange,
      targetWeight: Math.min(first.weight, 2000),
      loadMode,
    });
  }
  draft.customExercises = [...customExercises.values()];
  return draft;
}
