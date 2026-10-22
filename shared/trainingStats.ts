import type { Exercise, LoadMode, Workout } from './types';
import { personalRecordsFromWorkouts, recordKey } from './personalRecords';

export interface ExerciseStat {
  exerciseId: string;
  name: string;
  loadMode: LoadMode;
  points: { date: string; weight: number; reps: number }[];
  personalBest?: { weight: number; reps: number; date: string };
}

/** Build actual completed working-set trends, keeping distinct load modes separate. */
export function exerciseStatsFromWorkouts(
  workouts: Workout[],
  customExercises: Exercise[] = [],
): ExerciseStat[] {
  const best = new Map(
    personalRecordsFromWorkouts(workouts, customExercises).best.map((record) => [
      recordKey(record.exerciseId, record.loadMode),
      record,
    ]),
  );
  const byKey = new Map<string, ExerciseStat>();
  const ordered = workouts
    .filter((workout) => workout.status === 'finished')
    .slice()
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));

  for (const workout of ordered) {
    const workoutBest = new Map<
      string,
      { exerciseId: string; name: string; loadMode: LoadMode; weight: number; reps: number }
    >();
    for (const exercise of workout.exercises) {
      const sets = exercise.actualSets.filter(
        (set) => set.status === 'completed' && set.kind === 'working',
      );
      if (!sets.length) continue;
      const byMode = new Map<LoadMode, typeof sets>();
      for (const set of sets)
        byMode.set(set.loadMode ?? exercise.loadMode, [
          ...(byMode.get(set.loadMode ?? exercise.loadMode) ?? []),
          set,
        ]);
      for (const [loadMode, modeSets] of byMode) {
        let best = modeSets[0];
        for (const set of modeSets.slice(1)) {
          const better =
            loadMode === 'assistance'
              ? set.weight < best.weight || (set.weight === best.weight && set.reps > best.reps)
              : set.weight > best.weight || (set.weight === best.weight && set.reps > best.reps);
          if (better) best = set;
        }
        const key = `${exercise.exerciseId}\u0000${loadMode}`;
        const prior = workoutBest.get(key);
        const betterForWorkout =
          !prior ||
          (loadMode === 'assistance'
            ? best.weight < prior.weight || (best.weight === prior.weight && best.reps > prior.reps)
            : best.weight > prior.weight ||
              (best.weight === prior.weight && best.reps > prior.reps));
        if (betterForWorkout)
          workoutBest.set(key, {
            exerciseId: exercise.exerciseId,
            name: exercise.name,
            loadMode,
            weight: best.weight,
            reps: best.reps,
          });
      }
    }
    for (const [key, point] of workoutBest) {
      const stat = byKey.get(key) ?? {
        exerciseId: point.exerciseId,
        name: point.name,
        loadMode: point.loadMode,
        points: [],
      };
      stat.points.push({ date: workout.startedAt, weight: point.weight, reps: point.reps });
      byKey.set(key, stat);
    }
  }
  return [...byKey.values()]
    .map((stat) => {
      const record = best.get(recordKey(stat.exerciseId, stat.loadMode));
      return {
        ...stat,
        points: stat.points.slice(-8),
        ...(record
          ? { personalBest: { weight: record.weight, reps: record.reps, date: record.date } }
          : {}),
      };
    })
    .sort((a, b) => b.points.length - a.points.length || a.name.localeCompare(b.name));
}
