import { catalog } from './catalog';
import type { Exercise, LoadMode, Workout } from './types';

export interface PersonalRecord {
  workoutId: string;
  exerciseInstanceId: string;
  exerciseId: string;
  setId: string;
  name: string;
  loadMode: LoadMode;
  weight: number;
  reps: number;
  date: string;
}

const excludedExerciseIds = new Set([
  'ex_plank',
  'ex_side-plank',
  'ex_wall-sit',
  'ex_weighted-plank',
  'ex_farmers-carry',
  'ex_suitcase-carry',
]);

/** Stable identity for a PR stream; actual set load mode is part of the identity. */
export function recordKey(exerciseId: string, mode: LoadMode): string {
  return `${exerciseId}\u0000${mode}`;
}

function canonicalWeight(weight: number): number {
  // Stored weights are canonical pounds. Rounding absorbs unit-conversion noise.
  return Math.round(weight * 1_000_000) / 1_000_000;
}

function recordEligible(exercise: Exercise | undefined, mode: LoadMode): boolean {
  if (!exercise || excludedExerciseIds.has(exercise.id)) return false;
  // Records need a comparable repetition load; time-based holds/carries and
  // suspension-supported movements do not have a meaningful external-load PR.
  const definition = `${exercise.name} ${exercise.equipment}`.toLowerCase();
  if (/plank|wall\s*sit|carry|hold/.test(definition)) return false;
  if (/band|suspension\s+trainer/i.test(exercise.equipment)) return false;
  if (mode === 'assistance') return /assisted\s+machine/i.test(exercise.equipment);
  return mode === 'external' || mode === 'per-dumbbell' || mode === 'bodyweight';
}

function better(candidate: PersonalRecord, incumbent: PersonalRecord): boolean {
  if (candidate.loadMode === 'assistance') return candidate.weight < incumbent.weight;
  return candidate.weight > incumbent.weight;
}

/** Recalculate records from one user's complete workout history. */
export function personalRecordsFromWorkouts(
  workouts: Workout[],
  customExercises: Exercise[] = [],
): { best: PersonalRecord[]; achievements: PersonalRecord[] } {
  const exercises = new Map<string, Exercise>();
  for (const exercise of catalog) exercises.set(exercise.id, exercise);
  for (const exercise of customExercises) exercises.set(exercise.id, exercise);

  const ordered = workouts
    .filter((workout) => workout.status === 'finished')
    .slice()
    .sort((a, b) => {
      const aTime = Date.parse(a.startedAt);
      const bTime = Date.parse(b.startedAt);
      const chronological =
        Number.isFinite(aTime) && Number.isFinite(bTime)
          ? aTime - bTime
          : a.startedAt.localeCompare(b.startedAt);
      return chronological || a.id.localeCompare(b.id);
    });
  const bestByKey = new Map<string, PersonalRecord>();
  const achievements: PersonalRecord[] = [];

  for (const workout of ordered) {
    const workoutBest = new Map<string, PersonalRecord>();
    for (const instance of workout.exercises) {
      const exercise = exercises.get(instance.exerciseId);
      for (const set of instance.actualSets) {
        const mode = set.loadMode ?? instance.loadMode;
        const weight = canonicalWeight(set.weight);
        if (
          set.status !== 'completed' ||
          set.kind !== 'working' ||
          !Number.isFinite(set.reps) ||
          set.reps < 1 ||
          !Number.isFinite(weight) ||
          weight < 0 ||
          !recordEligible(exercise, mode)
        )
          continue;
        if (mode !== 'assistance' && weight === 0) continue;
        const record: PersonalRecord = {
          workoutId: workout.id,
          exerciseInstanceId: instance.id,
          exerciseId: instance.exerciseId,
          setId: set.id,
          name: exercise!.name,
          loadMode: mode,
          weight,
          reps: set.reps,
          date: workout.startedAt,
        };
        const key = recordKey(record.exerciseId, mode);
        const current = workoutBest.get(key);
        if (!current || better(record, current)) workoutBest.set(key, record);
      }
    }

    // Each finished workout contributes at most one performance per exercise/mode.
    // Stable traversal preserves the earliest set/instance when loads tie.
    for (const [key, record] of workoutBest) {
      const previous = bestByKey.get(key);
      if (!previous)
        bestByKey.set(key, record); // baseline is not an achievement
      else if (better(record, previous)) {
        achievements.push(record);
        bestByKey.set(key, record);
      }
    }
  }

  const compare = (a: PersonalRecord, b: PersonalRecord) =>
    recordKey(a.exerciseId, a.loadMode).localeCompare(recordKey(b.exerciseId, b.loadMode));
  return { best: [...bestByKey.values()].sort(compare), achievements };
}
