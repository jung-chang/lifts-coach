// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ProfileSetup } from '../src/components/ProfileSetup';
import type { AccountSession } from '../shared/community';
import { patchProfile } from '../src/lib/communityApi';
vi.mock('../src/lib/communityApi', () => ({ patchProfile: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const session: AccountSession = {
  accountId: 'synthetic-account',
  email: 'member@example.test',
  coachEnabled: false,
  profileSetupRequired: true,
  profile: { publicId: 'synthetic-profile', displayName: 'Member abcd', trainingTimezone: 'UTC' },
  sharing: {
    summaryEnabled: false,
    autoPublishWorkouts: false,
    policyRevision: 1,
    audienceAcknowledgedAt: null,
    enabledAt: null,
  },
};
it('saves the name and device timezone before continuing without changing sharing', async () => {
  vi.mocked(patchProfile).mockResolvedValue({ ...session, profileSetupRequired: false });
  const onComplete = vi.fn();
  render(<ProfileSetup session={session} onComplete={onComplete} />);
  const button = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Display name'), { target: { value: '  Friend  ' } });
  fireEvent.click(button);
  await waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
  expect(patchProfile).toHaveBeenCalledWith(
    session.accountId,
    {
      displayName: 'Friend',
      trainingTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    expect.any(AbortSignal),
  );
  expect(screen.getByText(/Workouts and stats start private/)).toBeTruthy();
});
it('keeps the form and entered name when saving fails', async () => {
  vi.mocked(patchProfile).mockRejectedValue(new Error('Connection lost. Try again.'));
  const onComplete = vi.fn();
  render(<ProfileSetup session={session} onComplete={onComplete} />);
  fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Friend' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByRole('alert');
  expect(onComplete).not.toHaveBeenCalled();
  expect((screen.getByLabelText('Display name') as HTMLInputElement).value).toBe('Friend');
  expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(
    false,
  );
});
