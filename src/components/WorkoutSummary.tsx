import { ArrowLeft, Check, RotateCcw } from 'lucide-react';
import type { AccountSession } from '../../shared/community';
import type { Unit, Workout, WorkoutExercise } from '../../shared/types';
import { toDisplayWeight } from '../../shared/domain';
import { formatLoadValue } from './LoadSemantics';
import { WorkoutVisibilityControl } from './WorkoutVisibilityControl';
import { Button } from './ui/Button';

export function WorkoutSummary({
  workout,
  unit,
  session,
  synced,
  onBack,
  onRepeat,
  onCorrection,
}: {
  workout: Workout;
  unit: Unit;
  session: AccountSession | null;
  synced: boolean;
  onBack: () => void;
  onRepeat: () => void;
  onCorrection: (exercise: WorkoutExercise) => void;
}) {
  const performed = workout.exercises.filter((e) =>
    e.actualSets.some((s) => s.status === 'completed'),
  );
  const sets = performed
    .flatMap((e) => e.actualSets)
    .filter((s) => s.status === 'completed' && s.kind === 'working').length;
  const minutes = workout.completedAt
    ? Math.max(
        0,
        Math.round((Date.parse(workout.completedAt) - Date.parse(workout.startedAt)) / 60000),
      )
    : null;
  return (
    <main className="page own-workout-summary">
      <Button className="back-button" variant="ghost" onClick={onBack}>
        <ArrowLeft size={16} /> Back
      </Button>
      <div className="page-heading">
        <div>
          <h1>{workout.name}</h1>
          <p className="muted small">
            {new Date(workout.completedAt ?? workout.startedAt).toLocaleString()}
          </p>
        </div>
        <Button onClick={onRepeat}>
          <RotateCcw size={16} /> Repeat
        </Button>
      </div>
      <section className="card card-pad">
        <div className="summary-metadata">
          <span>
            {performed.length} {performed.length === 1 ? 'exercise' : 'exercises'}
          </span>
          <span>
            {sets} working {sets === 1 ? 'set' : 'sets'}
          </span>
          {minutes !== null && <span>{minutes} min</span>}
        </div>
        {workout.exercises.map((e) => (
          <section className="summary-exercise" key={e.id} aria-label={`${e.name} summary`}>
            <div className="row space-between">
              <h2>{e.name}</h2>
              <Button size="sm" variant="ghost" aria-label={e.name} onClick={() => onCorrection(e)}>
                Edit sets
              </Button>
            </div>
            {e.actualSets.some((s) => s.status === 'completed') ? (
              <table className="summary-set-table" aria-label={`${e.name} completed sets`}>
                <thead>
                  <tr>
                    <th>Set</th>
                    <th>Load</th>
                    <th>Reps</th>
                    <th>Done</th>
                  </tr>
                </thead>
                <tbody>
                  {e.actualSets.map(
                    (s, i) =>
                      s.status === 'completed' && (
                        <tr key={s.id}>
                          <td>{s.kind === 'warmup' ? 'Warm-up' : i + 1}</td>
                          <td>
                            {formatLoadValue(s.loadMode, toDisplayWeight(s.weight, unit), unit)}
                          </td>
                          <td>{s.reps}</td>
                          <td>
                            <span className="sr-only">Completed</span>
                            <Check size={17} className="summary-completed" aria-hidden="true" />
                          </td>
                        </tr>
                      ),
                  )}
                </tbody>
              </table>
            ) : (
              <p className="muted small">No completed sets.</p>
            )}
            {e.actualSets.some((s) => s.status !== 'completed') && (
              <p className="muted small">
                {e.actualSets.filter((s) => s.status !== 'completed').length} skipped or incomplete
                sets were not performed.
              </p>
            )}
          </section>
        ))}
        {(workout.notes || workout.feeling) && (
          <div className="summary-private-notes">
            <h3>Private workout notes</h3>
            <p>{workout.feeling}</p>
            <p className="multiline">{workout.notes}</p>
          </div>
        )}
      </section>
      <section className="card card-pad" style={{ marginTop: 18 }}>
        <WorkoutVisibilityControl
          session={session}
          workout={workout}
          synced={synced}
          onLocalChange={() => undefined}
        />
      </section>
    </main>
  );
}
