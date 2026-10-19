import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Workout } from '../../shared/types';
import { Button } from './ui/Button';

const dateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

function workoutDateKey(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : dateKey(date);
}

export function ProgressCalendar({
  workouts,
  onWorkout,
}: {
  workouts: Workout[];
  onWorkout?: (id: string) => void;
}) {
  const byDay = useMemo(() => {
    const grouped = new Map<string, Workout[]>();
    for (const workout of workouts) {
      if (workout.status !== 'finished') continue;
      const key = workout.trainingDate || workoutDateKey(workout.startedAt);
      if (!key) continue;
      grouped.set(key, [...(grouped.get(key) || []), workout]);
    }
    for (const sessions of grouped.values()) {
      sessions.sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
    }
    return grouped;
  }, [workouts]);

  const latestDay = [...byDay.keys()].sort().at(-1);
  const [month, setMonth] = useState(() => {
    const initial = latestDay ? new Date(`${latestDay}T12:00:00`) : new Date();
    return new Date(initial.getFullYear(), initial.getMonth(), 1);
  });
  const monthPrefix = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-`;
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const mondayOffset = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7;
  const cells = Array.from({ length: Math.ceil((mondayOffset + daysInMonth) / 7) * 7 }, (_, i) => {
    const day = i - mondayOffset + 1;
    return day > 0 && day <= daysInMonth ? day : null;
  });
  const currentMonthDays = [...byDay.keys()].filter((key) => key.startsWith(monthPrefix)).sort();
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const selected = selectedDay?.startsWith(monthPrefix)
    ? selectedDay
    : currentMonthDays.at(-1) || null;
  const selectedWorkouts = selected ? byDay.get(selected) || [] : [];
  const today = dateKey(new Date());

  const moveMonth = (amount: number) => {
    setMonth((value) => new Date(value.getFullYear(), value.getMonth() + amount, 1));
    setSelectedDay(null);
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
              aria-label={`${fullDate}${count ? `, ${count} completed ${count === 1 ? 'workout' : 'workouts'}` : ''}`}
              aria-pressed={isSelected}
              aria-current={key === today ? 'date' : undefined}
              className={`progress-calendar-day${count ? ' has-workout' : ''}${isSelected ? ' selected' : ''}`}
              onClick={() => setSelectedDay(key)}
            >
              <span>{day}</span>
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
        {selectedWorkouts.length ? (
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
                    <button className="calendar-workout-link" onClick={() => onWorkout(workout.id)}>
                      {workout.name}
                    </button>
                  ) : (
                    <span>{workout.name}</span>
                  )}
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="muted small">
            {byDay.size
              ? selected
                ? 'No workout logged on this day.'
                : 'No workouts this month.'
              : 'Completed workouts will appear here.'}
          </p>
        )}
      </div>
    </section>
  );
}
