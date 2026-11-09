import { useMemo, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { CalendarWorkout } from '../../shared/community';
import type { Workout } from '../../shared/types';
import { trainingDateAt } from '../../shared/trainingDates';
import { Button } from './ui/Button';

const dateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export type CalendarSelection = { month: string; day: string | null };
const todayKey = (timeZone?: string) =>
  timeZone ? trainingDateAt(new Date().toISOString(), timeZone) : dateKey(new Date());

export const initialCalendarSelection = (
  timeZone?: string,
  latestDay?: string,
): CalendarSelection => ({
  month: (latestDay || todayKey(timeZone)).slice(0, 7),
  day: null,
});

export function ProgressCalendar({
  workouts,
  onWorkout,
  timeZone,
}: {
  workouts: Workout[];
  onWorkout?: (id: string) => void;
  timeZone?: string;
}) {
  const sessions = useMemo(
    () =>
      workouts
        .filter(
          (workout) =>
            workout.status === 'finished' && Number.isFinite(Date.parse(workout.startedAt)),
        )
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
        .map((workout) => {
          const workoutTimeZone = workout.trainingTimezone || timeZone;
          return {
            id: workout.id,
            title: workout.name,
            trainingDate:
              workout.trainingDate ||
              (workoutTimeZone
                ? trainingDateAt(workout.startedAt, workoutTimeZone)
                : dateKey(new Date(workout.startedAt))),
          };
        }),
    [workouts, timeZone],
  );
  const [selection, setSelection] = useState(() =>
    initialCalendarSelection(
      timeZone,
      sessions
        .map((session) => session.trainingDate)
        .sort()
        .at(-1),
    ),
  );
  return (
    <WorkoutCalendar
      workouts={sessions}
      selection={selection}
      onSelectionChange={setSelection}
      onWorkout={onWorkout}
      timeZone={timeZone}
    />
  );
}

export function WorkoutCalendar({
  workouts,
  selection,
  onSelectionChange,
  onWorkout,
  timeZone,
  status,
  shared = false,
}: {
  workouts: CalendarWorkout[];
  selection: CalendarSelection;
  onSelectionChange: (selection: CalendarSelection) => void;
  onWorkout?: (id: string) => void;
  timeZone?: string;
  status?: ReactNode;
  shared?: boolean;
}) {
  const byDay = useMemo(() => {
    const grouped = new Map<string, CalendarWorkout[]>();
    for (const workout of workouts) {
      const sessions = grouped.get(workout.trainingDate);
      if (sessions) sessions.push(workout);
      else grouped.set(workout.trainingDate, [workout]);
    }
    return grouped;
  }, [workouts]);

  const month = new Date(`${selection.month}-01T12:00:00`);
  const monthPrefix = `${selection.month}-`;
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const mondayOffset = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7;
  const cells = Array.from({ length: Math.ceil((mondayOffset + daysInMonth) / 7) * 7 }, (_, i) => {
    const day = i - mondayOffset + 1;
    return day > 0 && day <= daysInMonth ? day : null;
  });
  const currentMonthDays = [...byDay.keys()].filter((key) => key.startsWith(monthPrefix)).sort();
  const selected = selection.day?.startsWith(monthPrefix)
    ? selection.day
    : currentMonthDays.at(-1) || null;
  const selectedWorkouts = selected ? byDay.get(selected) || [] : [];
  const today = todayKey(timeZone);

  const moveMonth = (amount: number) => {
    const next = new Date(month.getFullYear(), month.getMonth() + amount, 1);
    onSelectionChange({ month: dateKey(next).slice(0, 7), day: null });
  };

  return (
    <section className="card card-pad progress-calendar" aria-label="Workout calendar">
      <div className="progress-calendar-header">
        <div className="row progress-calendar-nav">
          <Button
            variant="secondary"
            size="sm"
            aria-label="Previous month"
            onClick={() => moveMonth(-1)}
          >
            <ChevronLeft size={17} />
          </Button>
          <span className="progress-calendar-month" aria-live="polite">
            {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          </span>
          <Button
            variant="secondary"
            size="sm"
            aria-label="Next month"
            onClick={() => moveMonth(1)}
          >
            <ChevronRight size={17} />
          </Button>
        </div>
      </div>
      <div
        className="progress-calendar-grid"
        aria-label={month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
      >
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, index) => (
          <span className="progress-calendar-weekday" key={`${day}-${index}`}>
            {day}
          </span>
        ))}
        {cells.map((day, index) => {
          if (!day) return <span className="progress-calendar-blank" key={`blank-${index}`} />;
          const key = `${monthPrefix}${String(day).padStart(2, '0')}`;
          const count = byDay.get(key)?.length || 0;
          const isSelected = selected === key;
          const fullDate = new Date(month.getFullYear(), month.getMonth(), day).toLocaleDateString(
            undefined,
            { month: 'long', day: 'numeric', year: 'numeric' },
          );
          return (
            <button
              key={key}
              type="button"
              aria-label={`${fullDate}${key === today ? ', Today' : ''}${count ? `, ${count} completed ${count === 1 ? 'workout' : 'workouts'}` : ''}`}
              aria-pressed={isSelected}
              aria-current={key === today ? 'date' : undefined}
              className={`progress-calendar-day${count ? ' has-workout' : ''}${isSelected ? ' selected' : ''}`}
              onClick={() => onSelectionChange({ month: selection.month, day: key })}
            >
              <span>{day}</span>
              {key === today && (
                <span className="calendar-today-label" aria-hidden="true">
                  Today
                </span>
              )}
              {count > 0 && (
                <span className="progress-calendar-dots" aria-hidden="true">
                  {count > 1 ? count : '•'}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="progress-calendar-selection" aria-live="polite">
        {status ||
          (selectedWorkouts.length ? (
            <>
              <div className="eyebrow">
                {new Date(`${selected}T12:00:00`).toLocaleDateString(undefined, {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                })}
              </div>
              <div className="progress-calendar-sessions">
                {selectedWorkouts.map((workout) => (
                  <div className="progress-calendar-session" key={workout.id}>
                    <span className="progress-calendar-marker" aria-hidden="true" />
                    {onWorkout ? (
                      <button
                        className="calendar-workout-link"
                        onClick={() => onWorkout(workout.id)}
                      >
                        {workout.title}
                      </button>
                    ) : (
                      <span>{workout.title}</span>
                    )}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="muted small">
              {shared
                ? selected
                  ? 'No shared workouts on this day.'
                  : 'No shared workouts this month.'
                : byDay.size
                  ? selected
                    ? 'No workout logged on this day.'
                    : 'No workouts this month.'
                  : 'Completed workouts will appear here.'}
            </p>
          ))}
      </div>
    </section>
  );
}
