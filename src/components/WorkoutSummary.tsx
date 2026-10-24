import { ArrowLeft, RotateCcw } from 'lucide-react';
import type { AccountSession } from '../../shared/community';
import type { Unit, Workout, WorkoutExercise } from '../../shared/types';
import { WorkoutDetails } from './WorkoutDetails';
import { WorkoutVisibilityControl } from './WorkoutVisibilityControl';
import { Button } from './ui/Button';
import type { PersonalRecord } from '../../shared/personalRecords';

export function WorkoutSummary({
  workout,
  unit,
  session,
  synced,
  onBack,
  onRepeat,
  onCorrection,
  records = [],
}: {
  workout: Workout;
  unit: Unit;
  session: AccountSession | null;
  synced: boolean;
  onBack: () => void;
  onRepeat: () => void;
  onCorrection: (exercise: WorkoutExercise) => void;
  records?: PersonalRecord[];
}) {
  return (
    <main className="page own-workout-summary">
      <Button className="back-button" variant="ghost" onClick={onBack}>
        <ArrowLeft size={16} /> Back
      </Button>
      <WorkoutDetails
        title={workout.name}
        startedAt={workout.startedAt}
        completedAt={workout.completedAt}
        timeZone={workout.trainingTimezone ?? session?.profile.trainingTimezone}
        unit={unit}
        headingLevel={1}
        recordSetIds={records
          .filter((record) => record.workoutId === workout.id)
          .map((record) => record.setId)}
        exercises={workout.exercises.map((exercise) => ({
          id: exercise.id,
          name: exercise.name,
          sets: exercise.actualSets.filter((set) => set.status === 'completed'),
        }))}
        headerAction={
          <Button variant="primary" onClick={onRepeat}>
            <RotateCcw size={16} /> Repeat
          </Button>
        }
        exerciseAction={(id) => {
          const exercise = workout.exercises.find((item) => item.id === id)!;
          return (
            <Button
              size="sm"
              variant="ghost"
              aria-label={exercise.name}
              onClick={() => onCorrection(exercise)}
            >
              Edit sets
            </Button>
          );
        }}
        exerciseFooter={(id) => {
          const e = workout.exercises.find((item) => item.id === id)!;
          return (
            <>
              {e.persistentNote?.trim() && (
                <div className="summary-exercise-feedback">
                  <span className="small muted">Exercise instructions</span>
                  <p className="small multiline">{e.persistentNote}</p>
                </div>
              )}
              {e.actualSets.some((s) => s.status !== 'completed') && (
                <p className="muted small">
                  {e.actualSets.filter((s) => s.status !== 'completed').length} skipped or
                  incomplete sets were not performed.
                </p>
              )}
              {(e.repsInReserve || e.feeling || e.notes?.trim()) && (
                <div className="summary-exercise-feedback">
                  {e.repsInReserve ? (
                    <p className="small">
                      <span className="muted">Reps left: </span>
                      {e.repsInReserve.replace('-', '–')}
                    </p>
                  ) : e.feeling ? (
                    <p className="small">
                      <span className="muted">Felt </span>
                      {e.feeling.charAt(0).toUpperCase() + e.feeling.slice(1)}
                    </p>
                  ) : null}
                  {e.notes?.trim() && <p className="small multiline">{e.notes}</p>}
                </div>
              )}
            </>
          );
        }}
        footer={
          <>
            {(workout.notes?.trim() || workout.feeling) && (
              <div className="summary-private-notes">
                <h3>Workout feedback</h3>
                {workout.feeling && <p>{workout.feeling}</p>}
                {workout.notes?.trim() && <p className="multiline">{workout.notes}</p>}
              </div>
            )}
          </>
        }
      />

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
