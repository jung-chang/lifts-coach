import type { Workout } from '../../shared/types';
import { mondayOfDate, recentMondayDates, trainingDateAt } from '../../shared/trainingDates';

type Week = { startDate: string; sets: number };

export function workoutWeeks(workouts: Workout[], timeZone: string): Week[] {
  const counts = new Map<string, number>();
  for (const workout of workouts) {
    if (workout.status !== 'finished') continue;
    const day =
      workout.trainingDate ??
      trainingDateAt(workout.startedAt, workout.trainingTimezone ?? timeZone);
    const week = mondayOfDate(day);
    const sets = workout.exercises.reduce(
      (total, exercise) =>
        total +
        exercise.actualSets.filter((set) => set.kind === 'working' && set.status === 'completed')
          .length,
      0,
    );
    counts.set(week, (counts.get(week) ?? 0) + sets);
  }
  return Array.from(counts, ([startDate, sets]) => ({ startDate, sets }));
}

export function WeeklyVolume({ weeks, timeZone }: { weeks: Week[] | null; timeZone: string }) {
  const counts = new Map(weeks?.map(({ startDate, sets }) => [startDate, sets]));
  const chart = recentMondayDates(timeZone).map((date) => ({
    date,
    label: `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`,
    count: counts.get(date) ?? 0,
  }));
  const max = Math.max(1, ...chart.map((week) => week.count));
  const thisWeek = chart.at(-1)?.count ?? 0;
  return (
    <section className="card card-pad">
      <h2>Weekly volume</h2>
      {weeks === null ? (
        <p className="muted small">Profile stats are private.</p>
      ) : (
        <>
          <p className="muted small">Completed working sets · Monday–Sunday</p>
          {weeks.length ? (
            <>
              <div
                className="chart weekly-volume-chart"
                role="img"
                aria-label={`Completed working sets per week: ${chart.map((week) => `${week.label}: ${week.count}`).join(', ')}`}
              >
                {chart.map(({ date, label, count }) => (
                  <div className="chart-col" key={date}>
                    <span className="small tabular">{count}</span>
                    <div
                      className="chart-bar"
                      style={{
                        height: `${count ? Math.max(8, (count / max) * 67) : 2}%`,
                        opacity: count ? 1 : 0.18,
                      }}
                    />
                    <span className="chart-label">{label}</span>
                  </div>
                ))}
              </div>
              <div className="row space-between" style={{ marginTop: 13 }}>
                <span className="muted small">Last 8 weeks · week of</span>
                <span className="small">
                  {thisWeek} {thisWeek === 1 ? 'set' : 'sets'} this week
                </span>
              </div>
            </>
          ) : (
            <p className="progress-empty muted small">
              Weekly volume appears after a completed workout.
            </p>
          )}
        </>
      )}
    </section>
  );
}
