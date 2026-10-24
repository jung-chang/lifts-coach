import type { ExerciseSettings } from './types';

export function validateExerciseSettings(settings: ExerciseSettings): void {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings))
    throw new Error('Exercise settings must be an object');
  if (typeof settings.updatedAt !== 'string' || !Number.isFinite(Date.parse(settings.updatedAt)))
    throw new Error('Exercise settings need a valid update timestamp');
  if (
    settings.persistentNote !== undefined &&
    (typeof settings.persistentNote !== 'string' || settings.persistentNote.length > 2000)
  )
    throw new Error('Exercise note must be 2000 characters or fewer');
}
