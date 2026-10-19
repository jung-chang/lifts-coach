// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommunityScreen } from '../src/components/CommunityScreen';
import type { AccountSession } from '../shared/community';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const session: AccountSession = {
  accountId: 'acct-a',
  email: 'private@example.test',
  coachEnabled: false,
  profile: { publicId: 'me', displayName: 'My Name', trainingTimezone: 'UTC' },
  sharing: {
    summaryEnabled: false,
    autoPublishWorkouts: false,
    policyRevision: 1,
    audienceAcknowledgedAt: null,
    enabledAt: null,
  },
};
const profile = { publicId: 'person-a', displayName: 'Alex Example', trainingTimezone: 'UTC' };
const feedItem = {
  id: 'pub-a',
  profile,
  activityAt: '2026-10-18T15:00:00.000Z',
  title: 'Upper body',
  durationMinutes: 40,
  exerciseCount: 1,
  setCount: 2,
  exerciseNames: ['Bench press'],
};
const jsonResponse = (value: unknown) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

describe('CommunityScreen', () => {
  it('links a feed name to profile and the workout area to read-only expanded set detail', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/feed')) return jsonResponse({ items: [feedItem], nextCursor: null });
      if (url.includes('/profiles/person-a'))
        return jsonResponse({
          profile,
          scope: 'shared-workouts',
          weeks: [{ startDate: '2026-10-12', sets: 4 }],
          records: [],
          workouts: [feedItem],
        });
      if (url.includes('/workouts/pub-a'))
        return jsonResponse({
          id: 'pub-a',
          profile,
          title: 'Upper body',
          startedAt: '2026-10-18T14:20:00Z',
          completedAt: '2026-10-18T15:00:00Z',
          exercises: [
            {
              id: 'ex-1',
              exerciseId: 'bench',
              name: 'Bench press',
              loadMode: 'per-dumbbell',
              sets: [
                { id: 's1', weight: 25, reps: 8, kind: 'working' },
                { id: 's2', weight: 25, reps: 7, kind: 'warmup' },
              ],
            },
          ],
        });
      throw new Error(`Unexpected request ${url}`);
    });
    render(
      <CommunityScreen
        session={session}
        unit="lb"
        onSessionChange={() => {}}
        onSettings={() => {}}
        onCoach={() => {}}
      />,
    );
    const nameLink = await screen.findByRole('button', { name: 'Alex Example' });
    fireEvent.click(nameLink);
    expect(await screen.findByText('Shared workouts only')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Back to previous view/ }));
    fireEvent.click(
      await screen.findByRole('button', { name: /View Upper body workout by Alex Example/ }),
    );
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).getAllByText('25 lb each')).toHaveLength(2);
    expect(within(table).getByText('Warm-up')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Complete|Edit/ })).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/community/feed'),
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Lifts-Account': 'acct-a' }),
      }),
    );
  });

  it('shows explicit retry feedback on offline or failed feed requests', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network unavailable'));
    render(
      <CommunityScreen
        session={session}
        unit="kg"
        onSessionChange={() => {}}
        onSettings={() => {}}
        onCoach={() => {}}
      />,
    );
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Retry/ })).toBeTruthy();
  });

  it('clears community data when going offline and clears the old account feed on account switch', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      if (
        init?.headers &&
        (init.headers as Record<string, string>)['X-Lifts-Account'] === 'acct-b'
      ) {
        return jsonResponse({
          items: [
            {
              ...feedItem,
              id: 'pub-b',
              title: 'New account workout',
              profile: { ...profile, publicId: 'person-b' },
            },
          ],
          nextCursor: null,
        });
      }
      return jsonResponse({ items: [feedItem], nextCursor: null });
    });
    const view = render(
      <CommunityScreen
        session={session}
        unit="lb"
        onSessionChange={() => {}}
        onSettings={() => {}}
        onCoach={() => {}}
      />,
    );
    expect(await screen.findByText('Upper body')).toBeTruthy();
    window.dispatchEvent(new Event('offline'));
    await waitFor(() => expect(screen.queryByText('Upper body')).toBeNull());
    expect(screen.getByText('Connect to view community workouts.')).toBeTruthy();

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    window.dispatchEvent(new Event('online'));
    const nextSession = {
      ...session,
      accountId: 'acct-b',
      profile: { ...session.profile, publicId: 'me-b' },
    };
    view.rerender(
      <CommunityScreen
        session={nextSession}
        unit="lb"
        onSessionChange={() => {}}
        onSettings={() => {}}
        onCoach={() => {}}
      />,
    );
    expect(await screen.findByText('New account workout')).toBeTruthy();
    expect(screen.queryByText('Upper body')).toBeNull();
  });

  it('does not let a delayed feed response repopulate state after going offline', async () => {
    let resolveFeed: ((response: Response) => void) | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFeed = resolve;
        }),
    );
    render(
      <CommunityScreen
        session={session}
        unit="lb"
        onSessionChange={() => {}}
        onSettings={() => {}}
        onCoach={() => {}}
      />,
    );
    await waitFor(() => expect(resolveFeed).toBeTypeOf('function'));
    window.dispatchEvent(new Event('offline'));
    resolveFeed?.(jsonResponse({ items: [feedItem], nextCursor: null }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText('Upper body')).toBeNull();
    expect(screen.getByText('Connect to view community workouts.')).toBeTruthy();
  });

  it('deduplicates publication IDs across feed pages', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).includes('cursor=next'))
        return jsonResponse({
          items: [
            { ...feedItem, title: 'Updated title' },
            { ...feedItem, id: 'pub-b', title: 'Another workout' },
          ],
          nextCursor: null,
        });
      return jsonResponse({ items: [feedItem], nextCursor: 'next' });
    });
    render(
      <CommunityScreen
        session={session}
        unit="lb"
        onSessionChange={() => {}}
        onSettings={() => {}}
        onCoach={() => {}}
      />,
    );
    expect(await screen.findByText('Upper body')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Updated title')).toBeTruthy();
    expect(
      screen.getAllByRole('button', { name: /Updated title workout by Alex Example/ }),
    ).toHaveLength(1);
    expect(screen.getByText('Another workout')).toBeTruthy();
  });

  it('revalidates the feed when returning from a profile and exposes manual refresh', async () => {
    let feedCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).includes('/feed')) {
        feedCalls += 1;
        return jsonResponse({
          items: [{ ...feedItem, title: feedCalls === 1 ? 'Upper body' : 'Latest workout' }],
          nextCursor: null,
        });
      }
      if (String(input).includes('/profiles/person-a'))
        return jsonResponse({
          profile,
          scope: 'shared-workouts',
          weeks: [],
          records: [],
          workouts: [],
        });
      throw new Error('Unexpected request');
    });
    render(
      <CommunityScreen
        session={session}
        unit="lb"
        onSessionChange={() => {}}
        onSettings={() => {}}
        onCoach={() => {}}
      />,
    );
    expect(await screen.findByText('Upper body')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Alex Example' }));
    expect(await screen.findByText('Shared workouts only')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to previous view' }));
    expect(await screen.findByText('Latest workout')).toBeTruthy();
    expect(feedCalls).toBe(2);
    expect(screen.getByRole('button', { name: /Refresh feed/ })).toBeTruthy();
  });
});
