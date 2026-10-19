// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyData } from '../shared/domain';
import App from '../src/App';

const fixture = vi.hoisted(() => ({ update: vi.fn(), data: null as any }));
vi.mock('../src/lib/store', () => ({
  useAppStore: () => ({
    data: fixture.data,
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
