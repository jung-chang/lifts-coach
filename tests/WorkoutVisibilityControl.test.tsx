// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { WorkoutVisibilityControl } from '../src/components/WorkoutVisibilityControl';
import type { AccountSession } from '../shared/community';
import type { Workout } from '../shared/types';
afterEach(cleanup);
const session: AccountSession = {
  accountId: 'synthetic-account',
  email: 'sample@example.test',
  coachEnabled: false,
  profile: { publicId: 'synthetic-profile', displayName: 'Example', trainingTimezone: 'UTC' },
  sharing: {
    summaryEnabled: false,
    autoPublishWorkouts: true,
    policyRevision: 1,
    audienceAcknowledgedAt: '2026-10-01T12:00:00Z',
    enabledAt: '2026-10-01T12:00:00Z',
  },
};
const workout: Workout = {
  id: 'synthetic-workout',
  name: 'Upper body',
  status: 'finished',
  startedAt: '2026-10-22T12:00:00Z',
  completedAt: '2026-10-22T13:00:00Z',
  updatedAt: '2026-10-22T13:00:00Z',
  exercises: [],
};
function show(w = workout, s = session) {
  return render(
    <WorkoutVisibilityControl workout={w} session={s} synced={false} onLocalChange={() => {}} />,
  );
}
it('shows automatic sharing pending sync from the profile preference without requiring a share click', () => {
  show();
  expect(screen.getByText('Community after sync')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Make private' }).hasAttribute('disabled')).toBe(true);
});
it('keeps explicit private choices private even with automatic sharing enabled', () => {
  show({ ...workout, communityVisibility: { visibility: 'private', policyRevision: 1 } });
  expect(screen.getByText('Only me')).toBeTruthy();
});
it('keeps new workouts private when automatic sharing is off', () => {
  show(workout, { ...session, sharing: { ...session.sharing, autoPublishWorkouts: false } });
  expect(screen.getByText('Only me')).toBeTruthy();
});
it('does not announce automatic sharing for a workout started before the preference was enabled', () => {
  show({ ...workout, startedAt: '2026-09-01T12:00:00Z' });
  expect(screen.getByText('Only me')).toBeTruthy();
});
