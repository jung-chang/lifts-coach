import { describe, expect, it } from 'vitest';
import {
  createPrescription,
  createRoutine,
  emptyData,
  startWorkout,
  validateBackup,
} from '../shared/domain';
import { catalog } from '../shared/catalog';
import { mondayOfDate, recentMondayDates, trainingDateAt } from '../shared/trainingDates';

const fixture = () => {
  const routine = {
    ...createRoutine('Synthetic calendar routine'),
    exercises: [createPrescription(catalog[0].id)],
  };
  return startWorkout({ ...emptyData(), routines: [routine] }, routine.id);
};

describe('stable training dates', () => {
  it('uses profile calendar dates across midnight and a daylight-saving boundary', () => {
    expect(trainingDateAt('2026-11-02T00:30:00Z', 'America/New_York')).toBe('2026-11-01');
    expect(mondayOfDate('2026-11-01')).toBe('2026-10-26');
    const weeks = recentMondayDates('America/New_York', '2026-11-02T00:30:00Z');
    expect(weeks).toHaveLength(8);
    expect(weeks.at(-1)).toBe('2026-10-26');
    expect(weeks.at(-2)).toBe('2026-10-19');
  });

  it('round-trips new workout metadata and accepts backups written before profiles', () => {
    const data = fixture();
    expect(data.workouts[0].trainingDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(validateBackup(JSON.parse(JSON.stringify(data)))).toEqual(data);
    delete data.workouts[0].trainingDate;
    delete data.workouts[0].trainingTimezone;
    expect(validateBackup(data).workouts[0].trainingDate).toBeUndefined();
  });

  it('rejects impossible dates, invalid zones and malformed sharing snapshots', () => {
    const data = fixture();
    data.workouts[0].trainingDate = '2026-02-30';
    expect(() => validateBackup(data)).toThrow();
    data.workouts[0].trainingDate = '2026-02-28';
    data.workouts[0].trainingTimezone = 'Imaginary/Place';
    expect(() => validateBackup(data)).toThrow();
    data.workouts[0].trainingTimezone = 'UTC';
    data.workouts[0].communityVisibility = { visibility: 'community', policyRevision: -1 };
    expect(() => validateBackup(data)).toThrow();
  });
});
