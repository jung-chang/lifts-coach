// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkoutHistory, type HistoryItem } from '../src/components/TrainingHistory';

const items: HistoryItem[] = [
  {
    id: 'before',
    title: 'Before',
    date: '2026-10-01T03:59:00.000Z',
    durationMinutes: 42,
    setCount: 8,
  },
  {
    id: 'start',
    title: 'Start day',
    date: '2026-10-01T04:00:00.000Z',
    durationMinutes: 35,
    setCount: 6,
  },
  {
    id: 'end',
    title: 'End day',
    date: '2026-10-03T03:59:00.000Z',
    durationMinutes: 51,
    setCount: 10,
  },
  {
    id: 'after',
    title: 'After',
    date: '2026-10-03T04:00:00.000Z',
    durationMinutes: null,
    setCount: 0,
  },
];

const renderHistory = (onLoadMore = vi.fn()) =>
  render(
    <WorkoutHistory
      items={items}
      onWorkout={vi.fn()}
      onLoadMore={onLoadMore}
      timeZone="America/New_York"
    />,
  );

afterEach(cleanup);

describe('WorkoutHistory date filters', () => {
  it('preserves a captured training day when the profile timezone changes', () => {
    render(
      <WorkoutHistory
        items={[{ ...items[0], trainingDate: '2026-10-01' }]}
        timeZone="Asia/Tokyo"
        onWorkout={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-01' } });
    expect(screen.getByRole('button', { name: 'Before' })).toBeTruthy();
    expect(screen.getByText('Oct 1, 2026')).toBeTruthy();
  });
  it('includes both local date boundaries and shows date and duration metadata', () => {
    renderHistory();
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-02' } });

    expect(screen.getByText('Start day')).toBeTruthy();
    expect(screen.queryByText('Before')).toBeNull();
    expect(screen.getByText('End day')).toBeTruthy();
    expect(screen.queryByText('After')).toBeNull();
    expect(screen.getByText('Oct 1, 2026').parentElement?.textContent).toContain('35 min · 6 sets');
  });

  it('clears the range and restores all loaded history', () => {
    renderHistory();
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-02' } });
    expect(screen.queryByText('Start day')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Clear dates' }));
    expect(screen.getByText('Start day')).toBeTruthy();
    expect(screen.getByText('After')).toBeTruthy();
  });

  it('shows a no-match state while keeping pagination available', () => {
    const loadMore = vi.fn();
    renderHistory(loadMore);
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2027-01-01' } });
    expect(screen.getByText('No workouts match these dates.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(loadMore).toHaveBeenCalledOnce();
  });
});
