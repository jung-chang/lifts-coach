import { useId, useMemo, useState } from 'react';
import type { Exercise, Unit, Workout } from '../../shared/types';
import { toDisplayWeight } from '../../shared/domain';
import type { ExerciseStat } from '../../shared/trainingStats';
import { Button } from './ui/Button';
import { loadModeLabel, formatLoadValue } from './LoadSemantics';
import { personalRecordsFromWorkouts } from '../../shared/personalRecords';
import { RecordStar } from './PersonalRecords';
import { SearchPicker } from './SearchPicker';
import { WorkoutPreviewCard } from './WorkoutPreviewCard';

export interface HistoryItem {
  id: string;
  title: string;
  date: string;
  durationMinutes: number | null;
  setCount: number;
  notes?: string;
  feeling?: string;
  trainingDate?: string;
  completedAt?: string;
  exerciseCount?: number;
  hasRecord?: boolean;
}
export function historyItemsFromWorkouts(
  workouts: Workout[],
  customExercises: Exercise[] = [],
): HistoryItem[] {
  const recordWorkouts = new Set(
    personalRecordsFromWorkouts(workouts, customExercises).achievements.map(
      (record) => record.workoutId,
    ),
  );
  return workouts
    .filter((w) => w.status === 'finished')
    .slice()
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .map((w) => ({
      id: w.id,
      title: w.name,
      hasRecord: recordWorkouts.has(w.id),
      date: w.startedAt,
      completedAt: w.completedAt,
      exerciseCount: w.exercises.filter((exercise) =>
        exercise.actualSets.some((set) => set.status === 'completed'),
      ).length,
      trainingDate: w.trainingDate,
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

function dateKey(date: string, timeZone?: string) {
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

const dateLabel = (date: string, timeZone?: string) =>
  new Date(date).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone,
  });

export function ExerciseStats({
  stats,
  unit,
  timeZone,
}: {
  stats: ExerciseStat[];
  unit: Unit;
  timeZone?: string;
}) {
  const [selectedKey, setSelectedKey] = useState('');
  const instanceId = useId();
  const headingId = `${instanceId}-exercise-stats-heading`;
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
          <h2 id={headingId}>Strength trend</h2>
        </div>
        {selected && (
          <span className="progress-count muted small">{selected.points.length} sessions</span>
        )}
      </div>
      {stats.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <SearchPicker
            label="Choose an exercise"
            searchLabel="Search exercises"
            value={selected ? `${selected.exerciseId}:${selected.loadMode}` : ''}
            options={stats.map((item) => ({
              value: `${item.exerciseId}:${item.loadMode}`,
              label: item.name,
              description: loadModeLabel(item.loadMode),
              searchText: `${item.name} ${loadModeLabel(item.loadMode)}`,
            }))}
            onChange={setSelectedKey}
            placeholder="Search exercises"
            emptyMessage="No matching exercises"
          />
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
                  <span className="chart-label">{dateLabel(point.date, timeZone)}</span>
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
      {selected?.personalBest && (
        <p className="exercise-personal-best">
          <RecordStar
            label={
              selected.loadMode === 'assistance'
                ? 'Least assistance recorded'
                : 'Best load recorded'
            }
          />{' '}
          {selected.loadMode === 'assistance' ? 'Least assistance' : 'Best load'}:{' '}
          {formatLoadValue(
            selected.loadMode,
            toDisplayWeight(selected.personalBest.weight, unit),
            unit,
          )}
          <span className="muted"> · {dateLabel(selected.personalBest.date, timeZone)}</span>
        </p>
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
  timeZone,
}: {
  items: HistoryItem[];
  onWorkout: (id: string) => void;
  onRepeat?: (id: string) => void;
  onLoadMore?: () => void;
  loading?: boolean;
  emptyMessage?: string;
  timeZone?: string;
}) {
  const instanceId = useId();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const filteredItems = useMemo(
    () =>
      items.filter((item) => {
        const day = item.trainingDate || dateKey(item.date, timeZone);
        return Boolean(day) && (!from || day >= from) && (!to || day <= to);
      }),
    [items, from, to, timeZone],
  );
  const filtering = Boolean(from || to);
  return (
    <section className="workout-history" aria-label="Workout history">
      <div className="history-date-filters">
        <div className="form-field">
          <label htmlFor={`${instanceId}-history-from`}>From</label>
          <input
            id={`${instanceId}-history-from`}
            className="input"
            type="date"
            max={to || undefined}
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </div>
        <div className="form-field">
          <label htmlFor={`${instanceId}-history-to`}>To</label>
          <input
            id={`${instanceId}-history-to`}
            className="input"
            type="date"
            min={from || undefined}
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </div>
        {filtering && (
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setFrom('');
              setTo('');
            }}
          >
            Clear dates
          </Button>
        )}
      </div>
      {from && to && from > to && (
        <p className="muted small" role="alert">
          Choose an end date on or after the start date.
        </p>
      )}
      {filtering && onLoadMore && (
        <p className="muted small" style={{ margin: '0 0 12px' }}>
          Matches among workouts loaded so far.
        </p>
      )}
      {filteredItems.length === 0 ? (
        <p className="progress-empty muted small">
          {loading
            ? 'Loading workout history…'
            : filtering
              ? 'No workouts match these dates.'
              : emptyMessage}
        </p>
      ) : (
        <div className="workout-preview-list">
          {filteredItems.map((item) => (
            <WorkoutPreviewCard
              key={item.id}
              title={item.title}
              completedAt={item.completedAt ?? item.date}
              exerciseCount={item.exerciseCount}
              durationMinutes={item.durationMinutes}
              hasRecord={item.hasRecord}
              onOpen={() => onWorkout(item.id)}
              action={
                onRepeat ? (
                  <Button size="sm" variant="primary" onClick={() => onRepeat(item.id)}>
                    Repeat
                  </Button>
                ) : undefined
              }
            />
          ))}
        </div>
      )}
      {onLoadMore && (
        <div style={{ marginTop: 16 }}>
          <Button onClick={onLoadMore} disabled={loading}>
            {loading ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </section>
  );
}

export function TrainingLinks({
  onStats,
  onHistory,
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
        </span>
      </button>
      <button type="button" onClick={onHistory}>
        <span>
          <span>Workout history</span>
        </span>
      </button>
    </div>
  );
}
