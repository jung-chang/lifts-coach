// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyData } from '../shared/domain';
import App from '../src/App';

const fixture = vi.hoisted(() => ({
  update: vi.fn(),
  data: null as any,
  session: null as any,
  refreshSession: vi.fn(),
}));
vi.mock('../src/lib/store', () => ({
  useAppStore: () => ({
    data: fixture.data,
    session: fixture.session,
    identityStatus: 'verified',
    refreshSession: fixture.refreshSession,
    syncStatus: 'synced',
    update: fixture.update,
    conflict: null,
    retrySync: vi.fn(),
    resolveConflict: vi.fn(),
    exportData: vi.fn(),
    importData: vi.fn(),
  }),
}));

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  fixture.data = emptyData();
  fixture.session = {
    accountId: 'synthetic-account',
    email: 'member@example.test',
    coachEnabled: true,
    profileSetupRequired: false,
    profile: { publicId: 'synthetic-profile', displayName: 'Member', trainingTimezone: 'UTC' },
    sharing: {
      summaryEnabled: false,
      autoPublishWorkouts: false,
      policyRevision: 1,
      audienceAcknowledgedAt: null,
      enabledAt: null,
    },
  };
  fixture.update.mockReset();
  fixture.update.mockImplementation(async (updater) => {
    fixture.data = updater(fixture.data);
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ providers: [] })),
  );
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
  window.history.replaceState(null, '', '/');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function startDraft() {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Create routine' }));
  fireEvent.change(screen.getByLabelText('Routine name'), {
    target: { value: 'Synthetic push plan' },
  });
}

describe('integrated editor navigation', () => {
  it('shows profile setup before training for a newly verified account', () => {
    fixture.session.profileSetupRequired = true;
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Your profile' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create routine' })).toBeNull();
  });
  it('hides Coach controls for members while allowing manual routine creation', () => {
    fixture.session.coachEnabled = false;
    render(<App />);
    expect(screen.queryByRole('button', { name: /Ask Coach/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Create routine' }));
    expect(screen.getByLabelText('Routine name')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Ask Coach/ })).toBeNull();
  });
  it('offers explicit private-by-default sharing after a member finishes a workout', async () => {
    fixture.session.coachEnabled = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) =>
        Response.json(
          String(url).endsWith('/visibility') ? { visibility: 'private', decisionRevision: 0 } : [],
        ),
      ),
    );
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Use starter routine' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start workout' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Set 1 done' }));
    fireEvent.click(screen.getByRole('button', { name: 'Finish workout' }));
    const summary = await screen.findByRole('dialog', { name: 'Workout saved' });
    expect(within(summary).getByText('Only me')).toBeTruthy();
    await waitFor(() =>
      expect(
        (within(summary).getByRole('button', { name: 'Share workout' }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
  });
  it('opens routine creation directly with the new title field focused', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Create routine' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Routine name'));
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'auto' });
    fireEvent.change(screen.getByLabelText('Routine name'), {
      target: { value: 'Synthetic title' },
    });
    expect(window.scrollTo).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fixture.update).not.toHaveBeenCalled();
  });

  it('requires confirmation before deleting a saved routine', async () => {
    const { createRoutine } = await import('../shared/domain');
    fixture.data = { ...emptyData(), routines: [createRoutine('Synthetic push plan')] };
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Synthetic push plan' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete routine?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(fixture.data.routines).toHaveLength(1);
    expect(fixture.update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Synthetic push plan' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Delete routine?' })).getByRole('button', {
        name: 'Yes, delete',
      }),
    );
    await waitFor(() => expect(fixture.data.routines).toHaveLength(0));
  });

  it('preserves a changed draft when contextual Coach tries to open another routine', async () => {
    startDraft();
    fireEvent.click(screen.getByRole('button', { name: 'Ask Coach' }));
    const sheet = screen.getByRole('dialog');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Build a routine' }));
    expect(within(sheet).getByRole('alert').textContent).toContain(
      'Save or discard your current draft',
    );
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    expect(screen.getByLabelText('Routine name')).toHaveProperty('value', 'Synthetic push plan');
    expect(fixture.update).not.toHaveBeenCalled();
  });

  it('saves a draft then exits without triggering its dirty Back confirmation', async () => {
    startDraft();
    fireEvent.click(screen.getByRole('button', { name: 'Add exercise' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search exercises' }), {
      target: { value: 'Barbell bench press' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Barbell bench press.*chest/i }));
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {
      window.history.replaceState(null, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save routine' }));
    await waitFor(() => expect(screen.queryByLabelText('Routine name')).toBeNull());
    expect(fixture.data.routines[0].name).toBe('Synthetic push plan');
    expect(screen.queryByRole('dialog', { name: 'Discard routine changes?' })).toBeNull();
    expect(back).toHaveBeenCalledOnce();
    back.mockRestore();
  });
});
