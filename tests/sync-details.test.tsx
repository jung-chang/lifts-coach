// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyData, createRoutine } from '../shared/domain';
import { SyncDetails } from '../src/components/SyncDetails';

afterEach(cleanup);

describe('SyncDetails', () => {
  it('shows sync timing and pending work', () => {
    render(
      <SyncDetails
        syncStatus="offline"
        pendingCount={2}
        lastSyncedAt="2026-10-14T10:00:00.000Z"
        localData={emptyData()}
        conflict={null}
        onRetry={() => {}}
        onResolveConflict={() => {}}
      />,
    );
    expect(screen.getByText(/2 pending changes/)).toBeTruthy();
    expect(screen.getByText(/Last successful sync/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry sync' })).toBeTruthy();
  });

  it('compares both copies and leaves conflict resolution explicit', () => {
    const local = { ...emptyData(), routines: [createRoutine('Local')] };
    const remote = emptyData();
    // Empty remote workouts still gives a useful count while the local copy differs.
    const resolve = vi.fn();
    render(
      <SyncDetails
        syncStatus="conflict"
        pendingCount={1}
        lastSyncedAt={null}
        localData={local}
        conflict={{ revision: 4, data: remote }}
        onRetry={() => {}}
        onResolveConflict={resolve}
      />,
    );
    expect(screen.getByText('This device')).toBeTruthy();
    expect(screen.getByText('Other device')).toBeTruthy();
    expect(screen.getByText(/1 routines · 0 workouts/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use other copy' }));
    expect(resolve).toHaveBeenCalledWith('remote');
    expect(resolve).toHaveBeenCalledTimes(1);
  });
});
