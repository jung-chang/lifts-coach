// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OwnProfileScreen } from '../src/components/CommunityScreen';
import {
  createPrescription,
  createRoutine,
  emptyData,
  startWorkout,
  finishWorkout,
  setDone,
} from '../shared/domain';
import { catalog } from '../shared/catalog';
import type { AccountSession } from '../shared/community';

const session: AccountSession = {
  accountId: 'synthetic-account',
  email: 'private@example.test',
  coachEnabled: false,
  profile: { publicId: 'synthetic-profile', displayName: 'Alex Example', trainingTimezone: 'UTC' },
  sharing: {
    summaryEnabled: false,
    autoPublishWorkouts: true,
    policyRevision: 3,
    audienceAcknowledgedAt: '2026-10-18T00:00:00Z',
    enabledAt: '2026-10-18T00:00:00Z',
  },
};
function history() {
  const routine = {
    ...createRoutine('Synthetic profile workout'),
    exercises: [createPrescription(catalog[0].id)],
  };
  let data = startWorkout({ ...emptyData(), routines: [routine] }, routine.id);
  const w = data.workouts[0],
    e = w.exercises[0];
  data = setDone(data, w.id, e.id, e.actualSets[0].id, true);
  return finishWorkout(data, w.id);
}
const props = () => ({
  session,
  unit: 'lb' as const,
  data: history(),
  onSessionChange: vi.fn(),
  onSettings: vi.fn(),
  onBack: vi.fn(),
  onSignOut: vi.fn(),
  onWorkout: vi.fn(),
  onRepeat: vi.fn(),
});
beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('keeps the profile minimal and opens the reusable stats and history views', () => {
  const p = props();
  render(<OwnProfileScreen {...p} />);
  expect(screen.getByRole('heading', { name: 'Alex Example', level: 1 })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Edit display name' })).toBeTruthy();
  expect(screen.getAllByRole('switch')).toHaveLength(1);
  expect(screen.queryByText(session.email)).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Weekly volume' })).toBeNull();
  expect(screen.queryByRole('checkbox')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Exercise stats/ }));
  expect(screen.getByLabelText('Choose an exercise')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Back to profile' }));
  fireEvent.click(screen.getByRole('button', { name: /Workout history/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Synthetic profile workout' }));
  expect(p.onWorkout).toHaveBeenCalledWith(p.data.workouts[0].id);
  fireEvent.click(screen.getByRole('button', { name: 'Repeat' }));
  expect(p.onRepeat).toHaveBeenCalledWith(p.data.workouts[0].id);
});

it('edits only the display name through the pencil surface', async () => {
  const p = props(),
    next = { ...session, profile: { ...session.profile, displayName: 'New Name' } };
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(next));
  render(<OwnProfileScreen {...p} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit display name' }));
  const dialog = screen.getByRole('dialog', { name: 'Edit display name' });
  fireEvent.change(within(dialog).getByLabelText('Display name'), {
    target: { value: 'New Name' },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save name' }));
  await waitFor(() => expect(p.onSessionChange).toHaveBeenCalledWith(next));
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe('/api/me/profile');
  expect(JSON.parse(String(init?.body))).toEqual({
    displayName: 'New Name',
    trainingTimezone: 'UTC',
  });
  expect((init?.headers as Record<string, string>)['X-Lifts-Account']).toBe(session.accountId);
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('keeps sharing off on a failed save and preserves the independent workout setting on retry', async () => {
  const p = props(),
    next = { ...session, sharing: { ...session.sharing, summaryEnabled: true, policyRevision: 4 } };
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json({ error: 'changed' }, { status: 409 }))
    .mockResolvedValueOnce(Response.json(next));
  render(<OwnProfileScreen {...p} />);
  const toggle = screen.getByRole('switch', {
    name: 'Share profile stats with others in community',
  });
  fireEvent.click(toggle);
  await screen.findByRole('alert');
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
  expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
    summaryEnabled: true,
    autoPublishWorkouts: true,
    policyRevision: 3,
    audienceAcknowledged: true,
  });
});
