/** Calendar dates stay attached to the workout, even after a profile timezone change. */
export function trainingDateAt(stamp: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(stamp));
  const part = (name: string) => parts.find((p) => p.type === name)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function mondayOfDate(date: string): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7));
  return value.toISOString().slice(0, 10);
}

export function recentMondayDates(timezone: string, now = new Date().toISOString()): string[] {
  const current = mondayOfDate(trainingDateAt(now, timezone));
  return Array.from({ length: 8 }, (_, i) => {
    const date = new Date(`${current}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - (7 - i) * 7);
    return date.toISOString().slice(0, 10);
  });
}
