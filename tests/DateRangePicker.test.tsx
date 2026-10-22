// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DateRangePicker } from '../src/components/DateRangePicker';

afterEach(cleanup);
it('keeps edits staged on cancel and prevents a reversed range', () => {
  const change = vi.fn();
  render(<DateRangePicker from="2026-10-01" to="2026-10-02" onChange={change} />);
  const trigger = screen.getByRole('button', { name: /^Date range:/ });
  fireEvent.click(trigger);
  fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-04' } });
  expect(screen.getByRole('alert').textContent).toContain('end date');
  expect(screen.getByRole('button', { name: 'Apply dates' }).hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(trigger);
  expect((screen.getByLabelText('From') as HTMLInputElement).value).toBe('2026-10-01');
});

it('applies a calendar-selected range without converting local dates to UTC', () => {
  const change = vi.fn();
  render(<DateRangePicker from="2026-10-01" to="" onChange={change} />);
  fireEvent.click(screen.getByRole('button', { name: /^Date range:/ }));
  fireEvent.click(screen.getByRole('button', { name: /October 5.*2026/ }));
  expect((screen.getByLabelText('To') as HTMLInputElement).value).toBe('2026-10-05');
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Apply dates' }));
  expect(change).toHaveBeenCalledWith('2026-10-01', '2026-10-05');
});
