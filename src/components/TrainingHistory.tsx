import { useId, useState } from 'react';
import type { Unit, Workout } from '../../shared/types';
import { toDisplayWeight } from '../../shared/domain';
import type { ExerciseStat } from '../../shared/trainingStats';
import { Button } from './ui/Button';
import { loadModeLabel } from './LoadSemantics';

export interface HistoryItem {
  id: string;
  title: string;
  date: string;
  durationMinutes: number | null;
  setCount: number;
  notes?: string;
  feeling?: string;
}
export function historyItemsFromWorkouts(workouts: Workout[]): HistoryItem[] {
  return workouts
    .filter((w) => w.status === 'finished')
    .slice()
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .map((w) => ({
      id: w.id,
      title: w.name,
      date: w.startedAt,
      durationMinutes: w.completedAt
        ? Math.max(0, Math.round((Date.parse(w.completedAt) - Date.parse(w.startedAt)) / 60000))
        : null,
      setCount: w.exercises.reduce(
        (n, e) =>
          n + e.actualSets.filter((s) => s.status === 'completed' && s.kind === 'working').length,
        0,
      ),
      notes: w.notes,
      feeling: w.feeling,
    }));
}

const dateLabel = (date: string) =>
  new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export function ExerciseStats({ stats, unit }: { stats: ExerciseStat[]; unit: Unit }) {
  const [selectedKey, setSelectedKey] = useState('');
  const instanceId = useId();
  const headingId = `${instanceId}-exercise-stats-heading`;
  const selectId = `${instanceId}-training-exercise-stat`;
  const selected =
    stats.find((item) => `${item.exerciseId}:${item.loadMode}` === selectedKey) ?? stats[0];
  const points = selected?.points.slice(-8) ?? [];
  const repsOnly =
    selected?.loadMode === 'bodyweight' && points.every((point) => point.weight === 0);
  const values = points.map((point) =>
    repsOnly ? point.reps : toDisplayWeight(point.weight, unit),
  );
  const maxValue = Math.max(1, ...values);

  return (
    <section className="card card-pad" aria-labelledby={headingId}>
      <div className="row space-between">
        <div>
          <div className="eyebrow">Strength trend</div>
          <h2 id={headingId} style={{ marginTop: 4 }}>
            {selected?.name || 'Exercise progress'}
          </h2>
        </div>
        {selected && (
          <span className="progress-count muted small">{selected.points.length} sessions</span>
        )}
      </div>
      {stats.length > 0 && (
        <div className="form-field" style={{ marginTop: 12 }}>
          <label htmlFor={selectId}>Choose an exercise</label>
          <select
            id={selectId}
            className="select"
            value={selected ? `${selected.exerciseId}:${selected.loadMode}` : ''}
            onChange={(event) => setSelectedKey(event.target.value)}
          >
            {stats.map((item) => (
              <option
                key={`${item.exerciseId}:${item.loadMode}`}
                value={`${item.exerciseId}:${item.loadMode}`}
              >
                {item.name} · {loadModeLabel(item.loadMode)}
              </option>
            ))}
          </select>
        </div>
      )}
      {selected && points.length > 1 ? (
        <>
          <div
            className="chart strength-chart"
            role="img"
            aria-label={`Progress trend for ${selected.name} · ${loadModeLabel(selected.loadMode)}`}
          >
            {points.map((point, index) => {
              const value = values[index];
              return (
                <div className="chart-col" key={`${point.date}-${index}`}>
                  <span className="small tabular chart-value">
                    {value}
                    {repsOnly ? ' reps' : ''}
                  </span>
                  <div
                    className="chart-bar"
                    style={{ height: `${Math.max(12, (value / maxValue) * 68)}%` }}
                  />
                  <span className="chart-label">{dateLabel(point.date)}</span>
                </div>
              );
            })}
          </div>
          <p className="muted small" style={{ margin: '12px 0 0' }}>
            {repsOnly
              ? 'Best completed bodyweight working-set reps'
              : selected.loadMode === 'assistance'
                ? `Best completed working-set assistance in ${unit} · lower assistance means less support`
                : `Best completed working-set load · ${loadModeLabel(selected.loadMode).toLowerCase()} in ${unit}`}
          </p>
        </>
      ) : (
        <div className="progress-empty">
          <b>
            {stats.length ? 'Strength trends will build here' : 'No completed exercise stats yet'}
          </b>
          <p className="muted small">Complete a few workouts to see how your lifts change.</p>
        </div>
      )}
    </section>
  );
}

export function WorkoutHistory({
  items,
  onWorkout,
  onRepeat,
  onLoadMore,
  loading = false,
  emptyMessage = 'Your training history starts with the first workout.',
}: {
  items: HistoryItem[];
  onWorkout: (id: string) => void;
  onRepeat?: (id: string) => void;
  onLoadMore?: () => void;
  loading?: boolean;
  emptyMessage?: string;
}) {
  return (
    <section className="card card-pad" aria-label="Workout history">
      {items.length === 0 ? (
        <p className="progress-empty muted small">
          {loading ? 'Loading workout history…' : emptyMessage}
        </p>
      ) : (
        <>
          {items.map((item) => (
            <div key={item.id} className="history-item" style={{ alignItems: 'flex-start' }}>
              <div className="grow">
                <div className="row space-between">
                  <div>
                    <button className="history-workout-link" onClick={() => onWorkout(item.id)}>
                      <b>{item.title}</b>
                    </button>
                    <div className="muted small" style={{ marginTop: 4 }}>
                      {dateLabel(item.date)}
                      {item.durationMinutes !== null ? ` · ${item.durationMinutes} min` : ''} ·{' '}
                      {item.setCount} {item.setCount === 1 ? 'set' : 'sets'}
                    </div>
                  </div>
                  {onRepeat && (
                    <Button size="sm" variant="secondary" onClick={() => onRepeat(item.id)}>
                      Repeat
                    </Button>
                  )}
                </div>
                {(item.feeling || item.notes) && (
                  <p className="muted small" style={{ margin: '10px 0 0' }}>
                    {item.feeling && <b>{item.feeling}. </b>}
                    {item.notes}
                  </p>
                )}
              </div>
            </div>
          ))}
          {onLoadMore && (
            <div style={{ marginTop: 16 }}>
              <Button onClick={onLoadMore} disabled={loading}>
                {loading ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function TrainingLinks({
  onStats,
  onHistory,
  historyDescription = 'All sessions, corrections and repeat workouts',
}: {
  onStats: () => void;
  onHistory: () => void;
  historyDescription?: string;
}) {
  return (
    <div className="card card-pad progress-links">
      <button type="button" onClick={onStats}>
        <span>
          <span>Exercise stats</span>
          <span className="muted small">Strength trends</span>
        </span>
      </button>
      <button type="button" onClick={onHistory}>
        <span>
          <span>Workout history</span>
          <span className="muted small">{historyDescription}</span>
        </span>
      </button>
    </div>
  );
}
