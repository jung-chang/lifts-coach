import type { ReactNode } from 'react';
import type { LoadMode, Unit } from '../../shared/types';
import { toDisplayWeight } from '../../shared/domain';
import { formatLoadValue } from './LoadSemantics';
import { RecordStar } from './PersonalRecords';

type DetailSet = {
  id: string;
  kind: 'working' | 'warmup';
  weight: number;
  reps: number;
  loadMode: LoadMode;
};
export type DetailExercise = { id: string; name: string; sets: DetailSet[] };

/** Completed performance only. Owner-only controls and feedback are supplied by the caller. */
export function WorkoutDetails({
  title,
  startedAt,
  completedAt,
  timeZone,
  exercises,
  unit,
  headingLevel = 2,
  headerAction,
  exerciseAction,
  exerciseFooter,
  recordSetIds = [],
  owner,
  footer,
}: {
  title: string;
  startedAt: string;
  completedAt?: string;
  timeZone?: string;
  exercises: DetailExercise[];
  unit: Unit;
  headingLevel?: 1 | 2;
  headerAction?: ReactNode;
  exerciseAction?: (id: string) => ReactNode;
  exerciseFooter?: (id: string) => ReactNode;
  recordSetIds?: string[];
  owner?: ReactNode;
  footer?: ReactNode;
}) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  const ExerciseHeading = headingLevel === 1 ? 'h2' : 'h3';
  const durationSeconds = completedAt
    ? Math.max(0, Math.round((Date.parse(completedAt) - Date.parse(startedAt)) / 1000))
    : null;
  const minutes = durationSeconds === null ? null : Math.round(durationSeconds / 60);
  const duration =
    minutes === null
      ? 'Unavailable'
      : durationSeconds! < 60
        ? `${durationSeconds} sec`
        : minutes < 60
          ? `${minutes} min`
          : `${Math.floor(minutes / 60)} hr${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
  const completedExercises = exercises.filter((exercise) => exercise.sets.length > 0);
  const recordSets = new Set(recordSetIds);
  const hasRecord = exercises.some((exercise) =>
    exercise.sets.some((set) => recordSets.has(set.id)),
  );
  return (
    <section className="card card-pad workout-details">
      {owner && <div className="workout-preview-owner">{owner}</div>}
      <div className="page-heading">
        <Heading>
          {title} {hasRecord && <RecordStar />}
        </Heading>
        {headerAction}
      </div>
      <dl className="summary-metadata">
        <div>
          <dt>Finished</dt>
          <dd>
            {completedAt ? (
              <time dateTime={completedAt}>
                {new Intl.DateTimeFormat(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                  timeZone,
                }).format(new Date(completedAt))}
                {timeZone && (
                  <span className="summary-timezone"> · {timeZone.replaceAll('_', ' ')}</span>
                )}
              </time>
            ) : (
              'Unavailable'
            )}
          </dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{duration}</dd>
        </div>
        <div>
          <dt>Exercises</dt>
          <dd>{completedExercises.length}</dd>
        </div>
        <div>
          <dt>Working sets</dt>
          <dd>
            {completedExercises.reduce(
              (sum, exercise) => sum + exercise.sets.filter((set) => set.kind === 'working').length,
              0,
            )}
          </dd>
        </div>
      </dl>
      {exercises.map((exercise) => {
        let workingIndex = 0;
        let warmupIndex = 0;
        return (
          <section
            className="summary-exercise"
            key={exercise.id}
            aria-label={`${exercise.name} summary`}
          >
            <div className="row space-between">
              <ExerciseHeading className="summary-exercise-title">{exercise.name}</ExerciseHeading>
              {exerciseAction?.(exercise.id)}
            </div>
            {exercise.sets.length ? (
              <table className="summary-set-table" aria-label={`${exercise.name} completed sets`}>
                <thead>
                  <tr>
                    <th scope="col">Set</th>
                    <th scope="col">Load</th>
                    <th scope="col">Reps</th>
                  </tr>
                </thead>
                <tbody>
                  {exercise.sets.map((set) => (
                    <tr key={set.id}>
                      <td>{set.kind === 'warmup' ? `Warm-up ${++warmupIndex}` : ++workingIndex}</td>
                      <td>
                        {formatLoadValue(set.loadMode, toDisplayWeight(set.weight, unit), unit)}
                        {recordSets.has(set.id) && (
                          <>
                            {' '}
                            <RecordStar />
                          </>
                        )}
                      </td>
                      <td>{set.reps}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted small">No completed sets.</p>
            )}
            {exerciseFooter?.(exercise.id)}
          </section>
        );
      })}
      {footer}
    </section>
  );
}
