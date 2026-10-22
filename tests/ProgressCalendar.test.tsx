// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProgressCalendar } from '../src/components/ProgressCalendar';

const workout = (id: string, name: string, startedAt: string) =>
  ({
    id,
    name,
    startedAt,
    status: 'finished',
  }) as any;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ProgressCalendar', () => {
  it('marks today separately from the selected workout day', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 22, 12));
    render(
      <ProgressCalendar
        workouts={[workout('one', 'Upper body', new Date(2026, 9, 20, 8).toISOString())]}
      />,
    );
    const today = screen.getByRole('button', { name: /October 22, 2026, Today/ });
    expect(today.getAttribute('aria-current')).toBe('date');
    expect(today.textContent).toContain('Today');
    expect(today.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(today);
    expect(today.getAttribute('aria-pressed')).toBe('true');
    expect(today.getAttribute('aria-current')).toBe('date');
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(screen.queryByText('Today')).toBeNull();
  });
  it('groups sessions by local start day and shows multiple workouts for the selected day', () => {
    const localMorning = new Date(2026, 8, 12, 8).toISOString();
    const localEvening = new Date(2026, 8, 12, 19).toISOString();
    render(
      <ProgressCalendar
        workouts={[
          workout('one', 'Upper body', localMorning),
          workout('two', 'Conditioning', localEvening),
        ]}
      />,
    );

    expect(
      screen.getByRole('button', { name: /September 12, 2026, 2 completed workouts/i }),
    ).toBeTruthy();
    expect(screen.getByText('Upper body')).toBeTruthy();
    expect(screen.getByText('Conditioning')).toBeTruthy();
  });

  it('changes months and shows an empty-history message', () => {
    render(<ProgressCalendar workouts={[]} />);
    expect(screen.getByText('Completed workouts will appear here.')).toBeTruthy();
    const month = screen.getByText(/\d{4}/);
    const initial = month.textContent;
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(screen.getByText(/\d{4}/).textContent).not.toBe(initial);
  });

  it('does not count an unfinished workout as a training day', () => {
    const unfinished = {
      ...workout('active', 'In progress', new Date(2026, 8, 12, 8).toISOString()),
      status: 'active',
    };
    render(<ProgressCalendar workouts={[unfinished]} />);

    expect(screen.queryByText('In progress')).toBeNull();
    expect(screen.getByText('Completed workouts will appear here.')).toBeTruthy();
  });
});
