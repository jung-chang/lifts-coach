// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MakeWorkoutPrivate } from '../src/components/MakeWorkoutPrivate';
import type { AccountSession } from '../shared/community';

const session: AccountSession = {
  accountId: 'synthetic-account',
  email: 'member@example.test',
  coachEnabled: false,
  profile: { publicId: 'synthetic-profile', displayName: 'Member', trainingTimezone: 'UTC' },
  sharing: {
    summaryEnabled: true,
    autoPublishWorkouts: true,
    policyRevision: 3,
    audienceAcknowledgedAt: '2026-10-01T00:00:00Z',
    enabledAt: '2026-10-01T00:00:00Z',
  },
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('makes a shared workout private using its server revision without changing the default', async () => {
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json({ visibility: 'community', decisionRevision: 4 }))
    .mockResolvedValueOnce(Response.json({ visibility: 'private', decisionRevision: 5 }));
  const onPrivate = vi.fn();
  render(
    <MakeWorkoutPrivate session={session} workoutId="synthetic-workout" onPrivate={onPrivate} />,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Make private' }));
  await waitFor(() => expect(onPrivate).toHaveBeenCalledOnce());
  expect(screen.queryByRole('button', { name: 'Make private' })).toBeNull();
  expect(fetchMock.mock.calls[1][0]).toBe('/api/me/workouts/synthetic-workout/visibility');
  expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
    visibility: 'private',
    decisionRevision: 4,
    policyRevision: 3,
  });
  expect((fetchMock.mock.calls[1][1]?.headers as Record<string, string>)['X-Lifts-Account']).toBe(
    session.accountId,
  );
  expect(session.sharing.autoPublishWorkouts).toBe(true);
});

it('shows no sharing settings for an already private workout', async () => {
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(Response.json({ visibility: 'private', decisionRevision: 5 }));
  const { container } = render(
    <MakeWorkoutPrivate session={session} workoutId="synthetic-workout" />,
  );
  await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  await waitFor(() => expect(container.innerHTML).toBe(''));
});

it('keeps a failed privacy change actionable and reloads the server revision on retry', async () => {
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json({ visibility: 'community', decisionRevision: 4 }))
    .mockResolvedValueOnce(Response.json({}, { status: 409 }))
    .mockResolvedValueOnce(Response.json({ visibility: 'community', decisionRevision: 6 }))
    .mockResolvedValueOnce(Response.json({ visibility: 'private', decisionRevision: 7 }));
  const onPrivate = vi.fn();
  render(
    <MakeWorkoutPrivate session={session} workoutId="synthetic-workout" onPrivate={onPrivate} />,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Make private' }));
  await screen.findByRole('alert');
  expect(onPrivate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Make private' }));
  await waitFor(() => expect(onPrivate).toHaveBeenCalledOnce());
  expect(JSON.parse(String(fetchMock.mock.calls[3][1]?.body)).decisionRevision).toBe(6);
});
